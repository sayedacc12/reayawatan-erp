import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { today } from '../accounting/acc-core.service';
import { AccountsService } from '../accounting/accounts.service';
import { Account, AnalyticAccount } from '../accounting/entities/accounting.entity';
import { EntriesService } from '../accounting/entries.service';
import { MastersService } from '../accounting/masters.service';
import { SetupService } from '../accounting/setup.service';
import { VouchersService } from '../accounting/vouchers.service';
import { DemoTeam } from './demo-context';

/**
 * النظام المالي في الشركة التجريبية (مستقل حاليًا عن باقي الأنظمة): تنصيب الدليل الموحد، الافتتاحيات،
 * البنوك والشركاء، مراحل الاعتماد، سندات قبض وصرف بحالات مختلفة، قيود يدوية، وإغلاق الشهور السابقة.
 */
@Injectable()
export class AccountingSeed {
  private yearId = '';

  constructor(
    private readonly db: DataSource,
    private readonly accounts: AccountsService,
    private readonly setup: SetupService,
    private readonly masters: MastersService,
    private readonly vouchers: VouchersService,
    private readonly entries: EntriesService,
  ) {}

  async run(team: DemoTeam) {
    const { admin, finance } = team;
    const org = admin.organizationId;
    await this.accounts.installChart(admin);
    const now = today();
    const year = Number(now.slice(0, 4));
    const month = Number(now.slice(5, 7));
    const overview = await this.setup.setup(admin, {
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true,
      firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`, taxNumber: '310123456700003',
    });
    const yearId = overview.years[0].id;

    const chart = await this.db.getRepository(Account).find({ where: { organizationId: org }, order: { code: 'ASC' } });
    const acc = new Map(chart.map((a) => [a.code, a.id]));
    const id = (code: string) => acc.get(code)!;
    /** أول حساب ترحيل تحت رمز في الدليل الموحد (مع استثناء فرع إن لزم) */
    const leaf = (prefix: string, except?: string) => chart.find((a) => a.kind === 'sub' && a.code.startsWith(prefix) && (!except || !a.code.startsWith(except)))!.id;
    const cc = new Map((await this.db.getRepository(AnalyticAccount).find({ where: { organizationId: org } })).map((a) => [a.code, a.id]));
    const share = (code: string) => [{ analyticId: cc.get(code)!, percent: 100 }];

    // البنوك والصناديق
    const rajhi = await this.masters.createCash(admin, {
      kind: 'bank', name: 'مصرف الراجحي - الحساب الجاري', bankName: 'مصرف الراجحي', accountNumber: '608010167519',
      iban: 'SA0380000000608010167519', glAccountId: id('1110100201'),
    });
    const riyad = await this.masters.createCash(admin, {
      kind: 'bank', name: 'بنك الرياض - حساب التبرعات', bankName: 'بنك الرياض', accountNumber: '2110045570940', iban: 'SA4420000002110045570940', glAccountId: id('1110100101'),
    });
    const box = await this.masters.createCash(admin, { kind: 'cash', name: 'الصندوق العام', glAccountId: id('1110300101') });

    // العملاء والموردون
    const cats = await this.masters.listCategories(admin);
    const customers = cats.find((c) => c.behavior === 'customer')!.id;
    const suppliers = cats.find((c) => c.behavior === 'supplier')!.id;
    const grocer = await this.masters.createPartner(admin, {
      name: 'مؤسسة البركة للمواد الغذائية', categoryId: suppliers, accountId: id('2130200101'), phones: ['0112345678'], emails: ['sales@albaraka.example'],
      taxNumber: '300987654300003', crNumber: '1010456789', addresses: [{ label: 'المقر الرئيسي', address: 'حي السلي، شارع الخرج', city: 'الرياض' }],
    });
    await this.masters.createPartner(admin, {
      name: 'شركة الإعمار للخدمات', categoryId: suppliers, accountId: id('2130200201'), phones: ['0118765432'], taxNumber: '300112233400003',
    });
    const store = await this.masters.createPartner(admin, {
      name: 'متجر الخير الإلكتروني', categoryId: customers, accountId: id('1140200101'), creditLimit: 50000, phones: ['0551234567'], description: 'منفذ بيع منتجات الأسر المنتجة',
    });

    // مراحل الاعتماد: القبض بمرحلتين، والصرف بمرحلة يقررها المدير المالي
    await this.vouchers.saveStages(admin, 'receipt', { stages: [
      { name: 'مراجعة المحاسب', roleId: team.roles.finance, instructions: 'طابق المبلغ مع كشف البنك أو الإيصال' },
      { name: 'اعتماد المدير التنفيذي', roleId: null, instructions: null },
    ] });
    await this.vouchers.saveStages(admin, 'payment', { stages: [
      { name: 'اعتماد المدير المالي', roleId: team.roles.finance, instructions: 'تأكد من وجود الفاتورة وأمر الصرف' },
    ] });

    // تاريخ في الشهر m، ولا يتجاوز اليوم في الشهر الحالي
    const dayOf = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(m === month ? Math.min(d, Number(now.slice(8, 10))) : d).padStart(2, '0')}`;
    const approveAll = async (vid: string, stages: number) => {
      await this.vouchers.submit(admin, vid);
      for (let i = 0; i < stages; i++) await this.vouchers.decide(admin, vid, { decision: 'approve' });
    };
    const donors = ['عبدالرحمن السبيعي', 'نورة القحطاني', 'شركة الرواد القابضة', 'فهد الدوسري', 'مؤسسة العطاء الخيرية', 'سارة الشمري', 'محمد العنزي', 'هيفاء الزهراني'];
    const revenue = ['3110200101', '3110100101', '3110200401', '3110200301', '3110200501'];
    const purposes = ['تبرع لكفالة الأيتام', 'زكاة مال', 'تبرع للسلة الغذائية', 'تبرع لبرنامج إفطار صائم', 'دعم أسرة محتاجة'];

    for (let m = 1; m <= month; m++) {
      const last = m === month;
      // سندات قبض الشهر
      for (let k = 0; k < 2; k++) {
        const n = (m * 2 + k) % donors.length;
        const v = await this.vouchers.create(admin, 'receipt', {
          voucherDate: dayOf(m, k ? 18 : 5), partyName: donors[n], amount: 2500 + ((m * 7 + k * 13) % 9) * 1250, purpose: purposes[n % purposes.length],
          method: k ? 'transfer' : 'cash', methodRef: k ? `TRX-${m}${k}0${n}` : null,
          cashAccountId: k ? riyad.id : box.id, counterAccountId: id(revenue[n % revenue.length]),
        });
        if (!last || k === 0) await approveAll(v.id, 2);
        else await this.vouchers.submit(admin, v.id);
      }
      // سندات صرف الشهر
      const p1 = await this.vouchers.create(admin, 'payment', {
        voucherDate: dayOf(m, 10), partyName: 'مؤسسة البركة للمواد الغذائية', partnerId: grocer.id, amount: 3200 + (m % 4) * 600,
        purpose: 'توريد سلال غذائية للأسر المستفيدة', method: 'transfer', methodRef: `INV-${year}-${m}1`, cashAccountId: rajhi.id,
        counterAccountId: id('4210200401'), analytic: share('CC02'),
      });
      const p2 = await this.vouchers.create(admin, 'payment', {
        voucherDate: dayOf(m, 12), partyName: 'شركة الكهرباء السعودية', amount: 850 + (m % 3) * 120, purpose: `فاتورة كهرباء المقر لشهر ${m}`,
        method: 'transfer', cashAccountId: rajhi.id, counterAccountId: id('4120300101'), analytic: share('CC01'),
      });
      if (!last) {
        await approveAll(p1.id, 1);
        await approveAll(p2.id, 1);
      } else {
        await approveAll(p1.id, 1);
        await this.vouchers.submit(admin, p2.id);
      }
    }

    // أرصدة ما قبل النظام (القيد الافتتاحي اليدوي للسنة الأولى فقط)
    await this.entries.create(admin, {
      voucherType: 'opening', documentDate: `${year}-01-01`, description: 'الأرصدة الافتتاحية عند بدء استخدام النظام', post: true,
      lines: [
        { accountId: id('1110100201'), debit: 150000, credit: 0 }, { accountId: id('1110300101'), debit: 8000, credit: 0 },
        { accountId: id('2310100101'), debit: 0, credit: 158000 },
        // أصول الاستدامة وصافي الأصول المقيدة (تُستخدم في مؤشرات السلامة المالية في نظام الحوكمة)
        { accountId: id('1110100101'), debit: 95000, credit: 0 }, { accountId: leaf('23102'), debit: 0, credit: 95000 },
        { accountId: leaf('113'), debit: 180000, credit: 0 }, { accountId: id('2310100101'), debit: 0, credit: 180000 },
        { accountId: leaf('134'), debit: 1250000, credit: 0 }, { accountId: leaf('23103002'), debit: 0, credit: 1250000 },
      ],
    });
    // تحويل من بنك الرياض للراجحي (قيد يومية مرحّل) وإيجار المستودع (قيد غير مرحّل للشهر الحالي)
    await this.entries.create(admin, {
      voucherType: 'journal', documentDate: dayOf(1, 20), description: 'تحويل رصيد من حساب التبرعات إلى الحساب الجاري', post: true,
      lines: [{ accountId: id('1110100201'), debit: 5000, credit: 0 }, { accountId: id('1110100101'), debit: 0, credit: 5000 }],
    });
    // رواتب الشهور الماضية موزعة على مراكز التكلفة
    for (let m = 1; m < month; m++) {
      await this.entries.create(admin, {
        voucherType: 'journal', documentDate: dayOf(m, 27), description: `رواتب الموظفين لشهر ${m}`, post: true,
        lines: [
          { accountId: id('4110100101'), debit: 4000, credit: 0, analytic: [{ analyticId: cc.get('CC01')!, percent: 60 }, { analyticId: cc.get('CC02')!, percent: 40 }] },
          { accountId: id('1110100201'), debit: 0, credit: 4000 },
        ],
      });
    }
    await this.entries.create(admin, {
      voucherType: 'journal', documentDate: dayOf(month, 3), description: 'استحقاق إيجار مستودع التبرعات العينية',
      lines: [{ accountId: id('4120300903'), debit: 1500, credit: 0, analytic: share('CC02') }, { accountId: id('2130200201'), debit: 0, credit: 1500 }],
    });

    // سند قبض ملغي بعد اعتماده (اعتماد ثنائي): طلب المدير المالي واعتمده مدير النظام
    const wrong = await this.vouchers.create(admin, 'receipt', {
      voucherDate: dayOf(month, 2), partyName: 'متبرع (سند مكرر)', amount: 1000, purpose: 'تبرع عام', method: 'cash', cashAccountId: box.id, counterAccountId: id('3110200201'),
    });
    await approveAll(wrong.id, 2);
    await this.vouchers.request(finance, wrong.id, { kind: 'cancel', reason: 'السند مكرر لنفس الإيصال' });
    await this.vouchers.decideRequest(admin, wrong.id, { decision: 'approve' });

    // سند قبض من عميل مسجل: الحساب المقابل يُؤخذ تلقائيًا من ملف العميل
    const fromStore = await this.vouchers.create(admin, 'receipt', {
      voucherDate: dayOf(month, 4), partyName: 'متجر الخير الإلكتروني', partnerId: store.id, amount: 3750, purpose: 'تحصيل مبيعات منتجات الأسر المنتجة',
      method: 'transfer', methodRef: `STR-${year}-${month}`, cashAccountId: riyad.id,
    } as never);
    await approveAll(fromStore.id, 2);

    // قيد تسوية مرحّل في الشهر الماضي (يظهر في شاشة قيود التسوية ضمن العمليات)
    if (month > 1) {
      await this.entries.create(admin, {
        voucherType: 'adjustment', documentDate: dayOf(month - 1, 28), description: 'تسوية فرق عمولات بنكية مع كشف بنك الرياض', post: true,
        lines: [{ accountId: id('4120300101'), debit: 35, credit: 0, analytic: share('CC01') }, { accountId: id('1110100101'), debit: 0, credit: 35 }],
      });
    }

    // نوع سند خاص بالشركة (يظهر تحت العمليات): سند العهدة النثرية بتسلسل مستقل
    const types = await this.masters.createDocumentType(admin, { name: 'سند عهدة نثرية', description: 'صرف وتسوية العهد النقدية للموظفين' });
    const custody = types.find((t) => t.name === 'سند عهدة نثرية')!.code;
    for (const [m, amount, text, post] of [[Math.max(1, month - 1), 600, 'تسوية عهدة مشتريات مكتبية', true], [month, 420, 'عهدة ضيافة لقاء المتطوعين', false]] as const) {
      await this.entries.create(admin, {
        voucherType: custody, documentDate: dayOf(m, 8), description: text, post,
        lines: [{ accountId: id('4120300101'), debit: amount, credit: 0, analytic: share('CC01') }, { accountId: id('1110300101'), debit: 0, credit: amount }],
      });
    }

    // قيود شهرية بالتصنيف الوظيفي للمصروفات وعوائد الاستدامة (مصدر مؤشرات الأداء المالي في نظام الحوكمة):
    // تبرعات غير مقيدة، ريع أوقاف وإيرادات غير مقيدة، ومصروفات البرامج والإدارية المحملة والأوقاف والاستثمار وجمع الأموال والحوكمة.
    // مصاريف جمع الأموال ترتفع في الأشهر الأخيرة لتظهر إشارة الإنذار المبكر في نسبة جمع الأموال.
    for (let m = 1; m <= Math.max(1, month - 1); m++) {
      const fr = m >= month - 3 ? 7400 : 3100;
      await this.entries.create(admin, {
        voucherType: 'journal', documentDate: dayOf(m, 25), description: `إيرادات الشهر ${m}: التبرعات العامة وريع الأوقاف والإيرادات غير المقيدة`, post: true,
        lines: [
          { accountId: id('1110100101'), debit: 84500, credit: 0 },
          { accountId: leaf('31201'), debit: 0, credit: 72000 }, { accountId: leaf('31303'), debit: 0, credit: 8500 }, { accountId: leaf('31205'), debit: 0, credit: 4000 },
        ],
      });
      await this.entries.create(admin, {
        voucherType: 'journal', documentDate: dayOf(m, 26), description: `مصروفات الشهر ${m} حسب التصنيف الوظيفي`, post: true,
        lines: [
          { accountId: leaf('42', '423'), debit: 58000, credit: 0, analytic: share('CC02') },
          { accountId: leaf('423'), debit: 7600, credit: 0, analytic: share('CC02') },
          { accountId: leaf('41'), debit: 6200, credit: 0, analytic: share('CC01') },
          { accountId: leaf('46'), debit: 1400, credit: 0, analytic: share('CC01') },
          { accountId: leaf('43'), debit: 1900, credit: 0, analytic: share('CC01') },
          { accountId: leaf('45'), debit: 450, credit: 0, analytic: share('CC01') },
          { accountId: leaf('44'), debit: fr, credit: 0, analytic: share('CC01') },
          { accountId: id('1110100101'), debit: 0, credit: 75550 + fr },
        ],
      });
    }

    this.yearId = yearId;
  }

  /** إغلاق الشهور السابقة بالتسلسل (حتى الشهر قبل الماضي). يُستدعى بعد الأنظمة التي ترحّل قيودًا في الشهور السابقة (الأصول الثابتة) */
  async closeMonths(team: DemoTeam) {
    const now = today();
    const year = Number(now.slice(0, 4));
    const month = Number(now.slice(5, 7));
    for (let m = 1; m < month - 1; m++) {
      await this.setup.closeMonth(team.admin, this.yearId, `${year}-${String(m).padStart(2, '0')}`);
    }
  }
}
