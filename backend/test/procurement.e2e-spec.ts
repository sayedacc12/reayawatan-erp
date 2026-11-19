import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { similarNames } from '../src/modules/procurement/catalog.service';
import { ibanProblem, nameKey } from '../src/modules/procurement/procurement-core.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

jest.setTimeout(60_000);

describe('Procurement rules', () => {
  it('normalizes names and detects similar items', () => {
    expect(nameKey('  أرزّ   بسمتي  ')).toBe('ارز بسمتي');
    expect(nameKey('سلة غذائية')).toBe(nameKey('سله غذائيه'));
    expect(similarNames('أرز بسمتي 5 كيلو', 'ارز بسمتي')).toBe(true);
    expect(similarNames('زيت دوار الشمس 1.5 لتر', 'زيت دوار الشمس 1.8 لتر')).toBe(true);
    expect(similarNames('سكر أبيض', 'دقيق أبيض')).toBe(false);
  });

  it('validates Saudi IBANs with the checksum', () => {
    expect(ibanProblem('SA03 8000 0000 6080 1016 7519')).toBeNull();
    expect(ibanProblem('SA0380000000608010167518')).toContain('غير صحيح');
    expect(ibanProblem('GB29NWBK60161331926819')).toContain('SA');
  });
});

describe('Procurement module', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let uploadDir: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const PR = '/api/procurement';
  const SP = '/api/supplier-portal';

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir, PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية التوريد', slug: 'tawreed', adminFullName: 'مدير النظام', adminEmail: 'admin@tawreed.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.admin = await login('admin@tawreed.org', 'Admin12345', 'tawreed');
    // الدليل المحاسبي لربط المجموعات والمستودعات والموردين بحساباتهم
    await http.post('/api/accounting/chart/install').set(as(tok.admin)).expect(201);
    const chart = (await http.get('/api/accounting/accounts').set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string; name: string; kind: string; nature: string }[];
    acc.payables = chart.find((a) => a.code === '2130200101')!.id;
    acc.inventory = chart.find((a) => a.kind === 'sub' && a.nature === 'assets' && a.name.includes('مخزون'))!.id;
    acc.expense = chart.find((a) => a.kind === 'sub' && a.nature === 'expenses')!.id;
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@tawreed.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@tawreed.org`, 'Staff12345', 'tawreed');
    };
    await user('keeper', 'أمين المستودع', await role('أمين مستودع', ['procurement.dashboard.read', 'procurement.items.manage', 'procurement.warehouses.manage']));
    await user('buyer', 'مسؤول المشتريات', await role('مشتريات', ['procurement.dashboard.read', 'procurement.suppliers.read', 'procurement.suppliers.manage', 'procurement.banks.approve']));
    await user('manager', 'مدير المشتريات', await role('مدير مشتريات', ['procurement.dashboard.read', 'procurement.suppliers.read', 'procurement.suppliers.approve', 'procurement.banks.approve', 'procurement.reports.read']));
    await user('viewer', 'موظف اطلاع', await role('اطلاع', ['procurement.dashboard.read']));
  });

  afterAll(async () => {
    await app?.get(DataSource).destroy();
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('creates the suggested settings, units, groups and supplier categories on first use', async () => {
    const lk = (await http.get(`${PR}/lookups`).set(as(tok.keeper)).expect(200)).body;
    expect(lk.uoms.length).toBeGreaterThanOrEqual(10);
    expect(lk.groups.map((g: { code: string }) => g.code)).toEqual(expect.arrayContaining(['AID', 'FOOD', 'SRV', 'FA']));
    expect(lk.categories.length).toBeGreaterThanOrEqual(5);
    expect(lk.settings.supplierDocTypes.find((d: { key: string }) => d.key === 'cr').required).toBe(true);
    ids.food = lk.groups.find((g: { code: string }) => g.code === 'FOOD').id;
    ids.srv = lk.groups.find((g: { code: string }) => g.code === 'SRV').id;
    ids.piece = lk.uoms.find((u: { name: string }) => u.name === 'حبة').id;
    ids.carton = lk.uoms.find((u: { name: string }) => u.name === 'كرتون').id;
    ids.service = lk.uoms.find((u: { name: string }) => u.name === 'خدمة').id;
    ids.catFood = lk.categories[0].id;
    // المستخدم بلا صلاحية على المشتريات
    await http.post(`${PR}/items`).set(as(tok.viewer)).send({ name: 'x', groupId: ids.food, uomId: ids.piece }).expect(403);
  });

  it('groups carry their accounts, and an asset group must point to an asset group', async () => {
    await http.patch(`${PR}/groups/${ids.food}`).set(as(tok.keeper)).send({ code: 'FOOD', name: 'المواد الغذائية', kind: 'stock', inventoryAccountId: acc.expense }).expect(400);
    const groups = (await http.patch(`${PR}/groups/${ids.food}`).set(as(tok.keeper)).send({
      code: 'FOOD', name: 'المواد الغذائية', kind: 'stock', parentId: null, inventoryAccountId: acc.inventory, expenseAccountId: acc.expense,
    }).expect(200)).body;
    expect(groups.find((g: { id: string }) => g.id === ids.food).inventoryAccount.id).toBe(acc.inventory);
    await http.post(`${PR}/groups`).set(as(tok.keeper)).send({ code: 'FOOD', name: 'مكرر', kind: 'stock' }).expect(409);
    await http.post(`${PR}/groups`).set(as(tok.keeper)).send({ code: 'CARS', name: 'سيارات', kind: 'asset' }).expect(400);
  });

  it('codes items by group and blocks duplicates and look-alikes', async () => {
    const rice = (await http.post(`${PR}/items`).set(as(tok.keeper)).send({
      name: 'أرز بسمتي 5 كيلو', groupId: ids.food, uomId: ids.piece, units: [{ uomId: ids.carton, factor: 4, barcode: '6281000000011' }], barcode: '6281000000004',
      trackBatch: true, trackExpiry: true, shelfLifeDays: 365, minQty: 20, reorderPoint: 40, maxQty: 400, refPrice: 45,
      specs: [{ name: 'المنشأ', value: 'الهند' }],
    }).expect(201)).body;
    expect(rice.code).toBe('FOOD-0001');
    expect(rice.issuePolicy).toBe('fefo');
    expect(rice.effective.inventoryAccount.id).toBe(acc.inventory);
    ids.rice = rice.id;
    // نفس الاسم بعد التوحيد مرفوض دائمًا
    await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'ارز  بسمتى 5 كيلو', groupId: ids.food, uomId: ids.piece }).expect(409);
    // اسم قريب يحتاج تأكيدًا
    const similar = await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'أرز بسمتي', groupId: ids.food, uomId: ids.piece }).expect(409);
    expect(similar.body.message).toContain('FOOD-0001');
    // الباركود فريد بين الأصناف ووحداتها
    await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'سكر أبيض 10 كيلو', groupId: ids.food, uomId: ids.piece, barcode: '6281000000011' }).expect(409);
    // الحدود منطقية
    await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'سكر أبيض 10 كيلو', groupId: ids.food, uomId: ids.piece, minQty: 50, maxQty: 10 }).expect(400);
    const sugar = (await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'سكر أبيض 10 كيلو', groupId: ids.food, uomId: ids.piece }).expect(201)).body;
    expect(sugar.code).toBe('FOOD-0002');
    ids.sugar = sugar.id;
    const rice2 = (await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'أرز بسمتي 10 كيلو', groupId: ids.food, uomId: ids.piece, confirmSimilar: true }).expect(201)).body;
    ids.rice2 = rice2.id;
    // الخدمات لا تُتتبع
    await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'كشف طبي عام', groupId: ids.srv, uomId: ids.service, trackExpiry: true }).expect(400);
    const visit = (await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'كشف طبي عام', groupId: ids.srv, uomId: ids.service, kind: 'stock' }).expect(400));
    expect(visit.body.message).toContain('نوع الصنف');
    const svc = (await http.post(`${PR}/items`).set(as(tok.keeper)).send({ name: 'كشف طبي عام', groupId: ids.srv, uomId: ids.service }).expect(201)).body;
    expect(svc.kind).toBe('service');
    // البحث بالباركود والاسم الموحد
    const found = (await http.get(`${PR}/items?q=6281000000011`).set(as(tok.viewer)).expect(200)).body;
    expect(found.map((x: { code: string }) => x.code)).toEqual(['FOOD-0001']);
    expect((await http.get(`${PR}/items?q=${encodeURIComponent('ارز')}`).set(as(tok.viewer)).expect(200)).body.length).toBe(2);
    // لا يتغير رمز مجموعة فيها أصناف
    await http.patch(`${PR}/groups/${ids.food}`).set(as(tok.keeper)).send({ code: 'FD', name: 'المواد الغذائية', kind: 'stock' }).expect(409);
  });

  it('approves alternatives both ways, stops items with a replacement, and keeps their history', async () => {
    const r = (await http.post(`${PR}/items/${ids.rice}/alternatives`).set(as(tok.keeper)).send({ itemId: ids.rice2, kind: 'equivalent', note: 'نفس النوع بعبوة أكبر' }).expect(200)).body;
    expect(r.alternatives[0].item.id).toBe(ids.rice2);
    expect(r.alternatives[0].approvedByName).toBe('أمين المستودع');
    const other = (await http.get(`${PR}/items/${ids.rice2}`).set(as(tok.viewer)).expect(200)).body;
    expect(other.alternatives[0].itemId).toBe(ids.rice);
    await http.post(`${PR}/items/${ids.sugar}/stop`).set(as(tok.keeper)).send({ reason: 'ss' }).expect(400);
    const stopped = (await http.post(`${PR}/items/${ids.sugar}/stop`).set(as(tok.keeper)).send({ reason: 'توقف المورد عن توريده', replacedById: ids.rice2 }).expect(200)).body;
    expect(stopped.status).toBe('stopped');
    expect(stopped.replacedBy.id).toBe(ids.rice2);
    expect(stopped.log.map((l: { action: string }) => l.action)).toEqual(['إنشاء الصنف', 'إيقاف الصنف']);
    expect((await http.get(`${PR}/items/${ids.rice2}`).set(as(tok.viewer)).expect(200)).body.replaces[0].id).toBe(ids.sugar);
    // صورة الصنف ومرفقاته
    const img = (await http.post(`${PR}/items/${ids.rice}/image`).set(as(tok.keeper)).attach('file', PNG, 'rice.png').expect(200)).body;
    expect(img.imageMime).toBe('image/png');
    await http.post(`${PR}/items/${ids.rice}/image`).set(as(tok.keeper)).attach('file', PDF, 'spec.pdf').expect(400);
    const att = (await http.post(`${PR}/items/${ids.rice}/attachments`).set(as(tok.keeper)).attach('file', PDF, 'spec.pdf').expect(200)).body;
    const key = att.attachments[0].key.split('/').pop();
    await http.get(`${PR}/items/${ids.rice}/files/${key}`).set(as(tok.viewer)).expect(200);
    await http.get(`${PR}/items/${ids.rice}/files/image`).set(as(tok.viewer)).expect(200);
  });

  it('manages warehouses, their locations and accounts', async () => {
    const main = (await http.post(`${PR}/warehouses`).set(as(tok.keeper)).send({
      name: 'المستودع الرئيسي', kind: 'main', city: 'الرياض', keeperIds: [ids.user_keeper], glAccountId: acc.inventory, capacity: '400 م² منها غرفة مبردة',
    }).expect(201)).body;
    expect(main.code).toBe('WH-01');
    expect(main.keepers[0].name).toBe('أمين المستودع');
    ids.main = main.id;
    await http.post(`${PR}/warehouses`).set(as(tok.keeper)).send({ name: 'خطأ', kind: 'main', parentId: ids.main }).expect(400);
    await http.post(`${PR}/warehouses`).set(as(tok.keeper)).send({ name: 'حساب خطأ', kind: 'sub', parentId: ids.main, glAccountId: acc.payables }).expect(400);
    const field = (await http.post(`${PR}/warehouses`).set(as(tok.keeper)).send({ name: 'مستودع التوزيع الميداني', kind: 'field', parentId: ids.main }).expect(201)).body;
    expect(field.parentName).toBe('المستودع الرئيسي');
    let w = (await http.post(`${PR}/warehouses/${ids.main}/locations`).set(as(tok.keeper)).send({ code: 'a', name: 'منطقة الأغذية', kind: 'zone', purpose: 'storage' }).expect(201)).body;
    const zone = w.locationsList[0];
    expect(zone.label).toBe('WH-01/A');
    w = (await http.post(`${PR}/warehouses/${ids.main}/locations`).set(as(tok.keeper)).send({ code: 'A-01', name: 'رف 1', kind: 'rack', purpose: 'storage', parentId: zone.id }).expect(201)).body;
    await http.post(`${PR}/warehouses/${ids.main}/locations`).set(as(tok.keeper)).send({ code: 'A-01', name: 'مكرر', kind: 'rack', purpose: 'storage' }).expect(409);
    await http.post(`${PR}/warehouses/${ids.main}/locations`).set(as(tok.keeper)).send({ code: 'Q', name: 'منطقة العزل', kind: 'zone', purpose: 'quarantine' }).expect(201);
    await http.delete(`${PR}/warehouses/${ids.main}/locations/${zone.id}`).set(as(tok.keeper)).expect(409);
    // إيقاف المستودع الرئيسي يحتاج إيقاف فروعه أولًا
    await http.put(`${PR}/warehouses/${ids.main}`).set(as(tok.keeper)).send({ name: 'المستودع الرئيسي', kind: 'main', isActive: false, keeperIds: [ids.user_keeper], glAccountId: acc.inventory }).expect(409);
    // تحديد الحسابات على مستوى المستودع يجعل الحساب إلزاميًا
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ accountLevel: 'warehouse' }).expect(200);
    await http.post(`${PR}/warehouses`).set(as(tok.keeper)).send({ name: 'مستودع بلا حساب', kind: 'temporary' }).expect(400);
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ accountLevel: 'group' }).expect(200);
    // الحساب المربوط بمستودع لا يُحذف من الدليل
    await http.delete(`/api/accounting/accounts/${acc.inventory}`).set(as(tok.admin)).expect(409);
  });

  it('registers a supplier internally, reviews documents and approves only a complete file', async () => {
    const sup = (await http.post(`${PR}/suppliers`).set(as(tok.buyer)).send({
      name: 'مؤسسة الوفاء للتموين', entityType: 'establishment', supplierKind: 'supplier', categoryIds: [ids.catFood], activities: ['مواد غذائية', 'سلال غذائية وكسوة'],
      crNumber: '1010٢٢٢٣٣٣', vatNumber: '300000000000003', city: 'الرياض', phone: '0551234567', email: 'info@alwafa.sa',
      contacts: [{ name: 'خالد العمري', title: 'مدير المبيعات', phone: '0551234567', email: 'khalid@alwafa.sa', authorized: true }],
    }).expect(201)).body;
    expect(sup.code).toBe('SUP-0001');
    expect(sup.crNumber).toBe('1010222333');
    expect(sup.status).toBe('pending');
    ids.wafa = sup.id;
    await http.post(`${PR}/suppliers`).set(as(tok.buyer)).send({ name: 'مكرر', entityType: 'company', supplierKind: 'supplier', crNumber: '1010222333' }).expect(409);
    // الاعتماد يحتاج المستندات الإلزامية مقبولة
    const blocked = await http.post(`${PR}/suppliers/${ids.wafa}/decision`).set(as(tok.manager)).send({ decision: 'approve' }).expect(409);
    expect(blocked.body.message).toContain('السجل التجاري');
    await http.post(`${PR}/suppliers/${ids.wafa}/decision`).set(as(tok.buyer)).send({ decision: 'approve' }).expect(403);
    const up = (type: string, expiry?: string) => {
      const r = http.post(`${PR}/suppliers/${ids.wafa}/docs`).set(as(tok.buyer)).field('docType', type).attach('file', PDF, `${type}.pdf`);
      return expiry ? r.field('expiryDate', expiry) : r;
    };
    await up('cr').expect(400);
    await up('cr', '2020-01-01').expect(400);
    await up('cr', future(400)).expect(200);
    await up('zakat', future(200)).expect(200);
    let s = (await up('address').expect(200)).body;
    expect(s.checklist.missingDocs).toEqual([]);
    const pending = await http.post(`${PR}/suppliers/${ids.wafa}/decision`).set(as(tok.manager)).send({ decision: 'approve' }).expect(409);
    expect(pending.body.message).toContain('راجع المستندات');
    for (const d of s.docs) {
      s = (await http.post(`${PR}/suppliers/${ids.wafa}/docs/${d.id}/review`).set(as(tok.manager)).send({ decision: 'accept' }).expect(200)).body;
    }
    expect(s.crExpiry).toBe(future(400));
    // تجديد مستند يحفظ النسخة السابقة
    s = (await up('zakat', future(300)).expect(200)).body;
    expect(s.docs.filter((d: { docType: string }) => d.docType === 'zakat').map((d: { isCurrent: boolean }) => d.isCurrent)).toEqual([true, false]);
    await http.post(`${PR}/suppliers/${ids.wafa}/docs/${s.docs[0].id}/review`).set(as(tok.manager)).send({ decision: 'reject' }).expect(400);
    s = (await http.post(`${PR}/suppliers/${ids.wafa}/docs/${s.docs[0].id}/review`).set(as(tok.manager)).send({ decision: 'accept' }).expect(200)).body;
    s = (await http.post(`${PR}/suppliers/${ids.wafa}/decision`).set(as(tok.manager)).send({ decision: 'approve', note: 'ملف مكتمل' }).expect(200)).body;
    expect(s.status).toBe('approved');
    // لم تُضبط الإعدادات المالية فلا يُنشأ شريك تلقائيًا
    expect(s.partner).toBeNull();
    await http.post(`${PR}/suppliers/${ids.wafa}/partner`).set(as(tok.buyer)).expect(400);
  });

  it('links approved suppliers to accounting partners from the settings', async () => {
    const cats = (await http.get('/api/accounting/categories').set(as(tok.admin)).expect(200)).body as { id: string; behavior: string }[];
    const supplierCat = cats.find((c) => c.behavior === 'supplier')!.id;
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ partnerCategoryId: supplierCat, payablesAccountId: acc.inventory }).expect(400);
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ partnerCategoryId: cats.find((c) => c.behavior === 'customer')!.id }).expect(400);
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ partnerCategoryId: supplierCat, payablesAccountId: acc.payables }).expect(200);
    const s = (await http.post(`${PR}/suppliers/${ids.wafa}/partner`).set(as(tok.buyer)).expect(200)).body;
    expect(s.partner.name).toBe('مؤسسة الوفاء للتموين');
    const partners = (await http.get('/api/accounting/partners').set(as(tok.admin)).expect(200)).body as { id: string; taxNumber: string; account: { id: string } }[];
    const p = partners.find((x) => x.id === s.partner.id)!;
    expect(p.taxNumber).toBe('300000000000003');
    expect(p.account.id).toBe(acc.payables);
  });

  it('separates bank account requests from their approval and blocks shared IBANs', async () => {
    await http.post(`${PR}/suppliers/${ids.wafa}/banks`).set(as(tok.buyer)).field('bankName', 'مصرف الراجحي').field('iban', 'SA0380000000608010167518').field('accountName', 'مؤسسة الوفاء').expect(400);
    let s = (await http.post(`${PR}/suppliers/${ids.wafa}/banks`).set(as(tok.buyer))
      .field('bankName', 'مصرف الراجحي').field('iban', 'sa03 8000 0000 6080 1016 7519').field('accountName', 'مؤسسة الوفاء للتموين').attach('file', PDF, 'iban.pdf').expect(200)).body;
    const bank = s.banks[0];
    expect(bank.iban).toBe('SA0380000000608010167519');
    expect(bank.status).toBe('pending');
    // من طلب الحساب لا يعتمده
    await http.post(`${PR}/suppliers/${ids.wafa}/banks/${bank.id}/decision`).set(as(tok.buyer)).send({ decision: 'approve' }).expect(403);
    const bell = (await http.get('/api/tasks').set(as(tok.manager)).expect(200)).body;
    expect(JSON.stringify(bell)).toContain('حساب بنكي');
    s = (await http.post(`${PR}/suppliers/${ids.wafa}/banks/${bank.id}/decision`).set(as(tok.manager)).send({ decision: 'approve' }).expect(200)).body;
    expect(s.banks[0].status).toBe('approved');
    expect(s.banks[0].isPrimary).toBe(true);
    // نفس الآيبان لا يُسجل لمورد آخر
    const other = (await http.post(`${PR}/suppliers`).set(as(tok.buyer)).send({ name: 'شركة أخرى', entityType: 'company', supplierKind: 'service_provider', crNumber: '1010999888', city: 'جدة', phone: '0122223333' }).expect(201)).body;
    ids.other = other.id;
    await http.post(`${PR}/suppliers/${other.id}/banks`).set(as(tok.buyer)).field('bankName', 'الراجحي').field('iban', 'SA0380000000608010167519').field('accountName', 'شركة أخرى').expect(409);
    // تغيير الحساب: الجديد يصبح الرئيسي والقديم غير مستخدم
    s = (await http.post(`${PR}/suppliers/${ids.wafa}/banks`).set(as(tok.buyer)).field('bankName', 'البنك الأهلي').field('iban', 'SA4420000001234567891234').field('accountName', 'مؤسسة الوفاء للتموين').expect(200)).body;
    s = (await http.post(`${PR}/suppliers/${ids.wafa}/banks/${s.banks[0].id}/decision`).set(as(tok.manager)).send({ decision: 'approve' }).expect(200)).body;
    expect(s.banks.map((b: { status: string }) => b.status)).toEqual(['approved', 'inactive']);
    expect(s.log.map((l: { action: string }) => l.action)).toContain('اعتماد الحساب البنكي');
  });

  it('lets suppliers register from the portal, complete their file and submit it for review', async () => {
    const info = (await http.get(`${SP}/o/tawreed`).expect(200)).body;
    expect(info.open).toBe(true);
    expect(info.docTypes.length).toBeGreaterThan(5);
    const body = {
      name: 'شركة الشفاء الطبية', entityType: 'company', supplierKind: 'service_provider', activities: ['خدمات طبية وعلاجية'], city: 'الدمام',
      ownerName: 'سارة القحطاني', ownerEmail: 'sara@shifa.sa', ownerPhone: '0559876543', password: 'Shifa12345',
    };
    const { ownerName: _n, ownerEmail: _e, ownerPhone: _p, password: _w, ...profile } = body;
    await http.post(`${SP}/o/tawreed/register`).send({ ...body, password: 'short' }).expect(400);
    await http.post(`${SP}/o/tawreed/register`).send({ ...body, ownerEmail: 'khalid@alwafa.sa', crNumber: '1010222333' }).expect(409);
    tok.sara = (await http.post(`${SP}/o/tawreed/register`).send(body).expect(201)).body.accessToken;
    let me = (await http.get(`${SP}/me`).set(as(tok.sara)).expect(200)).body;
    expect(me.supplier.status).toBe('draft');
    expect(me.user.role).toBe('owner');
    ids.shifa = me.supplier.id;
    // لا يُرسل الطلب قبل اكتماله
    const incomplete = await http.post(`${SP}/submit`).set(as(tok.sara)).expect(400);
    expect(incomplete.body.message).toContain('رقم السجل التجاري');
    me = (await http.put(`${SP}/me`).set(as(tok.sara)).send({ ...profile, crNumber: '2050111222', phone: '0138887777' }).expect(200)).body;
    for (const [type, exp] of [['cr', future(500)], ['zakat', future(100)], ['address', null]] as const) {
      const r = http.post(`${SP}/docs`).set(as(tok.sara)).field('docType', type).attach('file', PDF, `${type}.pdf`);
      me = (await (exp ? r.field('expiryDate', exp) : r).expect(200)).body;
    }
    expect(me.checklist.complete).toBe(true);
    me = (await http.post(`${SP}/submit`).set(as(tok.sara)).expect(200)).body;
    expect(me.supplier.status).toBe('pending');
    expect(me.supplier.legalLocked).toBe(true);
    // البيانات النظامية مقفلة بعد الإرسال، وغيرها يتحدث
    await http.put(`${SP}/me`).set(as(tok.sara)).send({ ...profile, name: 'اسم آخر', crNumber: '2050111222', phone: '0138887777' }).expect(403);
    me = (await http.put(`${SP}/me`).set(as(tok.sara)).send({ ...profile, crNumber: '2050111222', phone: '0138887777', website: 'https://shifa.sa' }).expect(200)).body;
    expect(me.supplier.website).toBe('https://shifa.sa');
    // الموظف يعيد الطلب للاستكمال بملاحظة، والمورد يستكمل ويعيد الإرسال
    const ap = (await http.get(`${PR}/supplier-approvals`).set(as(tok.manager)).expect(200)).body;
    expect(ap.suppliers.map((x: { id: string }) => x.id)).toContain(ids.shifa);
    await http.post(`${PR}/suppliers/${ids.shifa}/decision`).set(as(tok.manager)).send({ decision: 'return' }).expect(400);
    await http.post(`${PR}/suppliers/${ids.shifa}/decision`).set(as(tok.manager)).send({ decision: 'return', note: 'أرفقوا الترخيص الصحي' }).expect(200);
    me = (await http.get(`${SP}/me`).set(as(tok.sara)).expect(200)).body;
    expect(me.supplier.status).toBe('returned');
    expect(me.supplier.reviewNote).toBe('أرفقوا الترخيص الصحي');
    me = (await http.post(`${SP}/docs`).set(as(tok.sara)).field('docType', 'license').field('expiryDate', future(20)).attach('file', PDF, 'license.pdf').expect(200)).body;
    me = (await http.post(`${SP}/submit`).set(as(tok.sara)).expect(200)).body;
    expect(me.supplier.status).toBe('pending');
    let s = (await http.get(`${PR}/suppliers/${ids.shifa}`).set(as(tok.manager)).expect(200)).body;
    for (const d of s.docs.filter((x: { isCurrent: boolean }) => x.isCurrent)) {
      s = (await http.post(`${PR}/suppliers/${ids.shifa}/docs/${d.id}/review`).set(as(tok.manager)).send({ decision: 'accept' }).expect(200)).body;
    }
    s = (await http.post(`${PR}/suppliers/${ids.shifa}/decision`).set(as(tok.manager)).send({ decision: 'approve' }).expect(200)).body;
    expect(s.status).toBe('approved');
    // ربط المالي تلقائي بعد ضبط الإعدادات
    expect(s.partner?.name).toBe('شركة الشفاء الطبية');
    expect(s.events.map((e: { event: string }) => e.event)).toEqual(expect.arrayContaining(['register', 'submitted', 'doc_uploaded']));
    // الترخيص الصحي ينتهي خلال 20 يومًا فيظهر في التنبيهات
    const dash = (await http.get(`${PR}/dashboard`).set(as(tok.viewer)).expect(200)).body;
    expect(dash.expiring.map((d: { title: string }) => d.title)).toContain('الترخيص المهني أو ترخيص النشاط');
    expect(dash.suppliers.approved).toBe(2);
  });

  it('runs portal accounts with roles, lockout, password reset and bank change requests', async () => {
    // مدير الحساب يضيف مستخدمين بأدوار
    let me = (await http.post(`${SP}/users`).set(as(tok.sara)).send({ fullName: 'فهد الدوسري', email: 'fahad@shifa.sa', role: 'viewer', password: 'Fahad12345' }).expect(200)).body;
    expect(me.users.length).toBe(2);
    const fahad = (await http.post(`${SP}/o/tawreed/login`).send({ email: 'fahad@shifa.sa', password: 'Fahad12345' }).expect(200)).body;
    expect(fahad.mustChangePassword).toBe(true);
    await http.get(`${SP}/me`).set(as(fahad.accessToken)).expect(200);
    await http.post(`${SP}/docs`).set(as(fahad.accessToken)).field('docType', 'gosi').attach('file', PDF, 'g.pdf').expect(403);
    tok.fahad = (await http.post(`${SP}/change-password`).set(as(fahad.accessToken)).send({ currentPassword: 'Fahad12345', newPassword: 'Fahad67890' }).expect(200)).body.accessToken;
    await http.post(`${SP}/docs`).set(as(tok.fahad)).field('docType', 'gosi').field('expiryDate', future(90)).attach('file', PDF, 'g.pdf').expect(403);
    expect((await http.get(`${SP}/me`).set(as(tok.fahad)).expect(200)).body.users).toEqual([]);
    // طلب حساب بنكي من البوابة يحتاج خطاب البنك، ويعتمده أي موظف مخول
    await http.post(`${SP}/banks`).set(as(tok.sara)).field('bankName', 'بنك الرياض').field('iban', 'SA4210000001234567890123').field('accountName', 'شركة الشفاء').expect(400);
    me = (await http.post(`${SP}/banks`).set(as(tok.sara)).field('bankName', 'بنك الرياض').field('iban', 'SA4210000001234567890123').field('accountName', 'شركة الشفاء').attach('file', PDF, 'b.pdf').expect(200)).body;
    expect(me.banks[0].status).toBe('pending');
    const s = (await http.post(`${PR}/suppliers/${ids.shifa}/banks/${me.banks[0].id}/decision`).set(as(tok.buyer)).send({ decision: 'approve' }).expect(200)).body;
    expect(s.banks[0].status).toBe('approved');
    // خمس محاولات خاطئة توقف الدخول مؤقتًا
    for (let i = 0; i < 5; i++) await http.post(`${SP}/o/tawreed/login`).send({ email: 'fahad@shifa.sa', password: 'Wrong12345' }).expect(401);
    const locked = await http.post(`${SP}/o/tawreed/login`).send({ email: 'fahad@shifa.sa', password: 'Fahad67890' }).expect(401);
    expect(locked.body.message).toContain('مؤقتًا');
    // الاستعادة بالبريد: الرد واحد، والرابط يعمل مرة واحدة
    const r1 = (await http.post(`${SP}/o/tawreed/forgot`).send({ email: 'nobody@shifa.sa' }).expect(200)).body;
    const r2 = (await http.post(`${SP}/o/tawreed/forgot`).send({ email: 'fahad@shifa.sa' }).expect(200)).body;
    expect(r1).toEqual(r2);
    const token = 'k'.repeat(40);
    await db.query(`UPDATE pr_supplier_users SET reset_token_hash = $1 WHERE email = 'fahad@shifa.sa'`, [createHash('sha256').update(token).digest('hex')]);
    const after = (await http.post(`${SP}/o/tawreed/reset`).send({ token, password: 'Fahad24680' }).expect(200)).body;
    await http.get(`${SP}/me`).set(as(after.accessToken)).expect(200);
    await http.get(`${SP}/me`).set(as(tok.fahad)).expect(401);
    await http.post(`${SP}/o/tawreed/reset`).send({ token, password: 'Fahad24680' }).expect(400);
    await http.post(`${SP}/o/tawreed/login`).send({ email: 'fahad@shifa.sa', password: 'Fahad24680' }).expect(200);
    // رموز الموظفين لا تفتح البوابة ورموز البوابة لا تفتح النظام
    await http.get(`${SP}/me`).set(as(tok.buyer)).expect(401);
    await http.get(`${PR}/items`).set(as(tok.sara)).expect(401);
  });

  it('suspends suppliers, invites portal accounts for internal suppliers and reports', async () => {
    await http.post(`${PR}/suppliers/${ids.shifa}/suspend`).set(as(tok.manager)).send({ reason: 'تأخر متكرر في التنفيذ' }).expect(200);
    await http.post(`${SP}/docs`).set(as(tok.sara)).field('docType', 'gosi').field('expiryDate', future(90)).attach('file', PDF, 'g.pdf').expect(403);
    expect((await http.get(`${SP}/me`).set(as(tok.sara)).expect(200)).body.supplier.status).toBe('suspended');
    await http.post(`${PR}/suppliers/${ids.shifa}/reactivate`).set(as(tok.manager)).expect(200);
    // حساب بوابة لمورد سجله الموظف بكلمة مؤقتة
    const inv = (await http.post(`${PR}/suppliers/${ids.wafa}/users`).set(as(tok.buyer)).send({ fullName: 'خالد العمري', email: 'khalid@alwafa.sa' }).expect(200)).body;
    expect(inv.users[0].role).toBe('owner');
    const first = (await http.post(`${SP}/o/tawreed/login`).send({ email: 'khalid@alwafa.sa', password: inv.tempPassword }).expect(200)).body;
    expect(first.mustChangePassword).toBe(true);
    await http.put(`${SP}/me`).set(as(first.accessToken)).send({ name: 'x', entityType: 'company', supplierKind: 'supplier' }).expect(403);
    await http.post(`${PR}/suppliers/${ids.wafa}/users`).set(as(tok.buyer)).send({ fullName: 'سارة القحطاني', email: 'sara@shifa.sa' }).expect(409);
    const mails = await db.query(`SELECT kind FROM mail_outbox WHERE kind LIKE 'supplier-%'`);
    expect(mails.map((m: { kind: string }) => m.kind)).toEqual(expect.arrayContaining(['supplier-invite', 'supplier-notice', 'supplier-reset']));
    for (const code of ['items', 'groups', 'warehouses', 'suppliers', 'supplier-docs', 'supplier-banks']) {
      const r = await http.get(`/api/reports/run/procurement.${code}`).set(as(tok.manager)).expect(200);
      expect(r.body.rows.length).toBeGreaterThan(0);
    }
    await http.get('/api/reports/run/procurement.items').set(as(tok.viewer)).expect(403);
  });
});
