import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { today } from '../accounting/acc-core.service';
import { AssetOpsService } from '../accounting/asset-ops.service';
import { AssetsService } from '../accounting/assets.service';
import { EntriesService } from '../accounting/entries.service';
import { MastersService } from '../accounting/masters.service';
import { VouchersService } from '../accounting/vouchers.service';
import { DemoTeam, daysAhead } from './demo-context';

type Ref = { id: string };

/**
 * الأصول الثابتة في الجمعية التجريبية (بعد النظام المالي والموارد البشرية): مجموعات بحساباتها، أصول بأرصدة افتتاحية
 * وعهد موظفين، إهلاك شهري مرحّل لكل شهر سابق، وعمليات في شهورها (شراء بنكي وآجل، تبرع عيني، إضافة، بيع، تخريد)،
 * وشراء ينتظر اعتماد سند الصرف، ونقل عهدة، وجرد بملصقات QR، وقيد يدوي على حساب أصل يُظهر علامة عدم المطابقة.
 * كل العمليات تمر عبر خدمات النظام نفسها، فتصدر سنداتها وقيودها بالترقيم المعتاد.
 */
@Injectable()
export class AssetsSeed {
  constructor(
    private readonly db: DataSource,
    private readonly assets: AssetsService,
    private readonly ops: AssetOpsService,
    private readonly vouchers: VouchersService,
    private readonly entries: EntriesService,
    private readonly masters: MastersService,
  ) {}

  async run(team: DemoTeam) {
    const { admin } = team;
    const org = admin.organizationId;
    const now = today();
    const year = Number(now.slice(0, 4));
    const month = Number(now.slice(5, 7));
    const ym = (m: number) => `${year}-${String(m).padStart(2, '0')}`;
    const day = (m: number, d: number) => `${ym(m)}-${String(d).padStart(2, '0')}`;

    const accRows: { id: string; code: string }[] = await this.db.query('SELECT id, code FROM acc_accounts WHERE organization_id = $1', [org]);
    const acc = new Map(accRows.map((a) => [a.code, a.id]));
    const id = (code: string) => acc.get(code)!;
    const cc: { id: string; code: string }[] = await this.db.query('SELECT id, code FROM acc_analytic_accounts WHERE organization_id = $1', [org]);
    const center = (code: string) => cc.find((c) => c.code === code)!.id;
    const [rajhi] = await this.db.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 AND gl_account_id = $2`, [org, id('1110100201')]);
    const emps: { id: string; no: number }[] = await this.db.query(
      `SELECT id, employee_no AS no FROM hr_employees WHERE organization_id = $1 AND status = 'active' ORDER BY employee_no`, [org]);
    const emp = (no: number) => (emps.find((e) => e.no === no) ?? emps[0]).id;

    const approve = async (voucherId: string, stages: number) => {
      for (let i = 0; i < stages; i++) await this.vouchers.decide(admin, voucherId, { decision: 'approve' });
    };

    // الإعدادات: بادئة الترميز، العهدة الإلزامية، كسر الشهر بالأيام، وحساب التبرعات العينية
    await this.assets.saveConfig(admin, { prefix: 'FA', requireCustody: true, alertDays: 45, partialMonth: 'days', donationAccountId: id('3120200101') });

    // المجموعات وتوجيهها المحاسبي
    const gain = id('3120500401');
    const group = (input: Record<string, unknown>) => this.assets.createGroup(admin, { gainLossAccountId: gain, ...input }) as Promise<Ref & { fields: { key: string; label: string }[] }>;
    const land = await group({ code: 'LAND', name: 'الأراضي', method: 'straight_line', rate: 0, assetAccountId: id('1210100201'), description: 'لا تُهلك الأراضي' });
    const bld = await group({
      code: 'BLD', name: 'المباني والإنشاءات', method: 'straight_line', rate: 4, assetAccountId: id('1210200201'), accumAccountId: id('2250100201'),
      expenseAccountId: id('4130200201'), analyticId: center('CC01'),
    });
    const car = await group({
      code: 'CAR', name: 'السيارات', method: 'straight_line', rate: 20, assetAccountId: id('1210400201'), accumAccountId: id('2250100401'),
      expenseAccountId: id('4130400201'), analyticId: center('CC02'),
      fields: [
        { label: 'رقم اللوحة', type: 'text', required: true },
        { label: 'انتهاء الاستمارة', type: 'date', required: true, expiry: true },
        { label: 'نوع الوقود', type: 'select', options: ['بنزين', 'ديزل'] },
      ],
    });
    const fur = await group({
      code: 'FUR', name: 'الأثاث المكتبي', method: 'straight_line', rate: 10, assetAccountId: id('1210500101'), accumAccountId: id('2250100501'),
      expenseAccountId: id('4130500101'), analyticId: center('CC01'),
    });
    const off = await group({
      code: 'OFF', name: 'الآلات والمعدات المكتبية', method: 'declining', rate: 30, assetAccountId: id('1210600101'), accumAccountId: id('2250100601'),
      expenseAccountId: id('4130600101'), analyticId: center('CC01'), description: 'قسط متناقص لأن منفعتها أعلى في سنواتها الأولى',
    });
    const it = await group({
      code: 'IT', name: 'أجهزة الحاسب الآلي', method: 'accelerated', lifeYears: 4, assetAccountId: id('1211000101'), accumAccountId: id('2250101001'),
      expenseAccountId: id('4131000101'), analyticId: center('CC01'), fields: [{ label: 'نظام التشغيل', type: 'text' }, { label: 'انتهاء الضمان', type: 'date', expiry: true }],
    });
    const key = (g: { fields: { key: string; label: string }[] }, label: string) => g.fields.find((f) => f.label === label)!.key;

    // بطاقات الأصول (كل أصل مادي في عهدة موظف من تاريخ استلامه)
    const asset = (input: Record<string, unknown>) => this.assets.create(admin, input) as Promise<Ref & { code: string }>;
    const opening = (assetId: string, purchaseDate: string, cost: number, accum: number) =>
      this.assets.saveOpening(admin, { assetId, purchaseDate, asOf: `${year - 1}-12-31`, cost, accum });

    const a = {
      land: await asset({ groupId: land.id, name: 'أرض المقر الرئيسي - حي النرجس', location: 'الرياض - حي النرجس', custodianEmployeeId: emp(1), custodyDate: `${year - 8}-01-01`, description: 'صك رقم 310115004321، مساحة 1,200 م²' }),
      hq: await asset({ groupId: bld.id, name: 'مبنى المقر الرئيسي', location: 'الرياض - حي النرجس', custodianEmployeeId: emp(1), custodyDate: `${year - 8}-01-01` }),
      bus: await asset({
        groupId: car.id, name: 'حافلة نقل المستفيدين هيونداي كاونتي', serialNumber: 'KMJHG17BPLC012345', location: 'موقف المقر', custodianEmployeeId: emp(2), custodyDate: `${year - 3}-07-01`,
        fieldValues: { [key(car, 'رقم اللوحة')]: 'ر س ج 4521', [key(car, 'انتهاء الاستمارة')]: daysAhead(20), [key(car, 'نوع الوقود')]: 'ديزل' },
        maintenance: [{ provider: 'الوكيل المعتمد - صيانة دورية', startDate: `${year}-01-01`, endDate: `${year}-12-31`, cost: 6500, notes: 'كل 10,000 كم' }],
      }),
      camry: await asset({
        groupId: car.id, name: 'سيارة تويوتا كامري (إدارية)', serialNumber: '4T1BF1FK0CU512345', location: 'موقف المقر', custodianEmployeeId: emp(7), custodyDate: `${year - 4}-01-01`,
        fieldValues: { [key(car, 'رقم اللوحة')]: 'ب ط ع 7310', [key(car, 'انتهاء الاستمارة')]: `${year + 1}-03-01`, [key(car, 'نوع الوقود')]: 'بنزين' },
      }),
      hall: await asset({ groupId: fur.id, name: 'أثاث قاعة الاجتماعات', location: 'المقر - الدور الأول', custodianEmployeeId: emp(1), custodyDate: `${year - 2}-01-01` }),
      desks: await asset({ groupId: fur.id, name: 'مكاتب وكراسي الموظفين (12 مكتبًا)', location: 'المقر - الدور الثاني', custodianEmployeeId: emp(7), custodyDate: `${year - 1}-03-01` }),
      cabinet: await asset({ groupId: fur.id, name: 'خزانة ملفات حديدية', location: 'المقر - الأرشيف', custodianEmployeeId: emp(8), custodyDate: `${year - 6}-01-01` }),
      copier: await asset({ groupId: off.id, name: 'طابعة وناسخة متعددة المهام', serialNumber: 'XRX-7845-2201', location: 'المقر - الدور الثاني', custodianEmployeeId: emp(7), custodyDate: `${year - 1}-01-01` }),
      server: await asset({
        groupId: it.id, name: 'خادم الشبكة والأرشفة', serialNumber: 'DL380-G10-5521', location: 'المقر - غرفة الخوادم', custodianEmployeeId: emp(7), custodyDate: `${year - 2}-01-01`,
        fieldValues: { [key(it, 'نظام التشغيل')]: 'Windows Server', [key(it, 'انتهاء الضمان')]: daysAhead(30) },
      }),
      pc: await asset({ groupId: it.id, name: 'حاسب مكتبي - البحث الاجتماعي', serialNumber: 'HP-PRO-4410', location: 'قسم البحث الاجتماعي', custodianEmployeeId: emp(3), custodyDate: `${year - 1}-01-01` }),
    };
    await opening(a.land.id, `${year - 8}-01-01`, 850000, 0);
    await opening(a.hq.id, `${year - 8}-01-01`, 1600000, 512000);
    await opening(a.bus.id, `${year - 3}-07-01`, 240000, 120000);
    await opening(a.camry.id, `${year - 4}-01-01`, 95000, 76000);
    await opening(a.hall.id, `${year - 2}-01-01`, 38000, 7600);
    await opening(a.desks.id, `${year - 1}-03-01`, 26000, 2166.67);
    await opening(a.cabinet.id, `${year - 6}-01-01`, 4500, 2700);
    await opening(a.copier.id, `${year - 1}-01-01`, 12000, 3600);
    await opening(a.server.id, `${year - 2}-01-01`, 18000, 12600);
    await opening(a.pc.id, `${year - 1}-01-01`, 4200, 1680);

    // القيد الافتتاحي المطابق لأرصدة الأصول (يطابقه تقرير المطابقة مع الدليل)
    await this.entries.create(admin, {
      voucherType: 'opening', documentDate: `${year}-01-01`, description: 'الأرصدة الافتتاحية للأصول الثابتة ومجمعات إهلاكها', post: true,
      lines: [
        { accountId: id('1210100201'), debit: 850000, credit: 0 },
        { accountId: id('1210200201'), debit: 1600000, credit: 0 }, { accountId: id('2250100201'), debit: 0, credit: 512000 },
        { accountId: id('1210400201'), debit: 335000, credit: 0 }, { accountId: id('2250100401'), debit: 0, credit: 196000 },
        { accountId: id('1210500101'), debit: 68500, credit: 0 }, { accountId: id('2250100501'), debit: 0, credit: 12466.67 },
        { accountId: id('1210600101'), debit: 12000, credit: 0 }, { accountId: id('2250100601'), debit: 0, credit: 3600 },
        { accountId: id('1211000101'), debit: 22200, credit: 0 }, { accountId: id('2250101001'), debit: 0, credit: 14280 },
        { accountId: id('2310100101'), debit: 0, credit: 2149353.33 },
      ],
    });

    // مورد السيارات (الشراء الآجل يفتح حسابه)
    const cats = await this.masters.listCategories(admin);
    const dealer = await this.masters.createPartner(admin, {
      name: 'شركة الجميح للسيارات', categoryId: cats.find((c) => c.behavior === 'supplier')!.id, accountId: id('2130200101'), phones: ['0114770000'], taxNumber: '300445566700003',
    });

    // العمليات في شهورها، ثم إهلاك كل شهر سابق
    const plan = new Map<number, (() => Promise<void>)[]>();
    const at = (m: number, fn: () => Promise<void>) => {
      if (m >= 1 && m < month) plan.set(m, [...(plan.get(m) ?? []), fn]);
    };
    // شراء حاسب محمول بحوالة بنكية (يدخل الدفاتر باعتماد سند الصرف)
    at(Math.min(2, month - 1), async () => {
      const lap = await asset({ groupId: it.id, name: 'حاسب محمول - الشؤون المالية', serialNumber: 'LEN-T14-8890', location: 'إدارة الشؤون المالية', custodianEmployeeId: emp(8), custodyDate: day(Math.min(2, month - 1), 9) });
      const op = await this.ops.purchase(admin, { assetId: lap.id, date: day(Math.min(2, month - 1), 9), amount: 5600, method: 'bank', cashAccountId: rajhi.id, partyName: 'مكتبة جرير', notes: 'فاتورة 88412' }) as { voucher: Ref };
      await approve(op.voucher.id, 1);
    });
    // شراء حافلة صغيرة بالأجل من الوكيل
    at(Math.min(3, month - 1), async () => {
      const m = Math.min(3, month - 1);
      const van = await asset({
        groupId: car.id, name: 'حافلة صغيرة تويوتا هايس', serialNumber: 'JTFSS22P0N0123456', location: 'موقف المقر', custodianEmployeeId: emp(2), custodyDate: day(m, 14),
        fieldValues: { [key(car, 'رقم اللوحة')]: 'ح د ل 2290', [key(car, 'انتهاء الاستمارة')]: `${year + 2}-${String(m).padStart(2, '0')}-14`, [key(car, 'نوع الوقود')]: 'بنزين' },
      });
      const op = await this.ops.purchase(admin, { assetId: van.id, date: day(m, 14), amount: 138000, method: 'credit', partnerId: dealer.id, notes: 'عقد بيع آجل على 6 دفعات' }) as { voucher: Ref };
      await approve(op.voucher.id, 1);
    });
    // تبرع عيني بمولد كهربائي بالقيمة العادلة (بلا سند صرف)
    at(Math.min(4, month - 1), async () => {
      const m = Math.min(4, month - 1);
      const gen = await asset({ groupId: off.id, name: 'مولد كهربائي احتياطي (تبرع عيني)', location: 'المقر - الفناء الخلفي', custodianEmployeeId: emp(7), custodyDate: day(m, 6) });
      await this.ops.donation(admin, { assetId: gen.id, date: day(m, 6), amount: 9500, partyName: 'مؤسسة الرواد للتجارة', notes: 'تقييم بسعر السوق بموجب عرض سعر' });
    });
    // إضافة رأسمالية على المبنى (تركيب مصعد) تُوزع على العمر المتبقي
    at(Math.min(5, month - 1), async () => {
      const op = await this.ops.purchase(admin, { kind: 'addition', assetId: a.hq.id, date: day(Math.min(5, month - 1), 20), amount: 85000, method: 'bank', cashAccountId: rajhi.id, partyName: 'شركة المصاعد الحديثة', notes: 'تركيب مصعد للمستفيدين من ذوي الإعاقة' }) as { voucher: Ref };
      await approve(op.voucher.id, 1);
    });
    // بيع السيارة الإدارية: إهلاك حتى تاريخ البيع ثم سند قبض بالأرباح أو الخسائر
    at(Math.max(1, month - 3), async () => {
      const op = await this.ops.sale(admin, { assetId: a.camry.id, date: day(Math.max(1, month - 3), 15), price: 21500, method: 'bank', cashAccountId: rajhi.id, partyName: 'معرض الصفوة للسيارات المستعملة' }) as { voucher: Ref };
      await approve(op.voucher.id, 2);
    });
    // تخريد خزانة الملفات التالفة
    at(Math.max(1, month - 2), async () => {
      await this.ops.scrap(admin, { assetId: a.cabinet.id, date: day(Math.max(1, month - 2), 10), notes: 'صدأ وتلف في الأقفال، وتقرير لجنة التخريد رقم 4' });
    });
    for (let m = 1; m < month; m++) {
      for (const fn of plan.get(m) ?? []) await fn();
      await this.ops.post(admin, { period: ym(m) });
    }

    // الشهر الحالي: شراء ينتظر اعتماد سند الصرف (لا يدخل الدفاتر ولا يُهلك قبل اعتماده)
    const projector = await asset({ groupId: off.id, name: 'جهاز عرض للقاعة التدريبية', location: 'المقر - القاعة التدريبية', custodianEmployeeId: emp(5) });
    await this.ops.purchase(admin, { assetId: projector.id, date: now, amount: 3900, method: 'cash', cashAccountId: (await this.cashBox(org)) ?? rajhi.id, partyName: 'متجر الأجهزة الذكية' });

    // نقل عهدة الحاسب المكتبي لباحثة أخرى (نموذج ينتظر تأكيد الاستلام)، وتأكيد نماذج التسليم الأولى
    await this.assets.moveCustody(admin, a.pc.id, { toEmployeeId: emp(4), toLocation: 'قسم البحث الاجتماعي', date: now, condition: 'جيد', notes: 'انتقال المهام بين الباحثتين' });
    const issues: { id: string }[] = await this.db.query(
      `SELECT c.id FROM acc_asset_custody c JOIN acc_assets x ON x.id = c.asset_id WHERE c.organization_id = $1 AND c.kind = 'issue' AND x.code <> $2 ORDER BY c.form_no`, [org, projector.code]);
    for (const f of issues) await this.assets.confirmCustody(admin, f.id);

    // جرد دوري مغلق: أصل في موقع مختلف، وأصل لم يُعثر عليه
    const st = await this.assets.createStocktake(admin, { title: `الجرد نصف السنوي ${year}`, date: now }) as Ref & { lines: { code: string }[] };
    for (const l of st.lines) {
      if (l.code === a.server.code || l.code === projector.code) continue;
      const moved = l.code === a.hall.code;
      await this.assets.count(admin, st.id, { code: `/accounting/assets/a/${l.code}`, location: moved ? 'المقر - الدور الثاني' : undefined, condition: moved ? 'يحتاج صيانة' : 'جيد' });
    }
    await this.assets.closeStocktake(admin, st.id);

    // قيد يدوي على حساب الأثاث من النظام المالي (خارج نظام الأصول) يُظهر علامة عدم المطابقة
    await this.entries.create(admin, {
      voucherType: 'journal', documentDate: now, description: 'شراء ستائر للقاعة سُجل مباشرة على حساب الأثاث', post: true,
      lines: [{ accountId: id('1210500101'), debit: 1250, credit: 0 }, { accountId: id('1110100201'), debit: 0, credit: 1250 }],
    });
  }

  private async cashBox(org: string): Promise<string | null> {
    const [box] = await this.db.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 AND kind = 'cash' ORDER BY name LIMIT 1`, [org]);
    return box?.id ?? null;
  }
}
