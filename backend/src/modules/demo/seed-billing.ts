import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { VouchersService } from '../accounting/vouchers.service';
import { BillingOpsService } from '../billing/billing-ops.service';
import { BILLING_PERMISSIONS as BP } from '../billing/billing.manifest';
import { CatalogService } from '../billing/catalog.service';
import { DocumentsService } from '../billing/documents.service';
import { DemoTeam, daysAgo } from './demo-context';

const ADDRESS = { street: 'طريق الملك عبدالعزيز', buildingNo: '2471', additionalNo: '8123', district: 'الملقا', city: 'الرياض', postalCode: '13521', country: 'SA' };

/**
 * الفوترة والمبيعات في الشركة التجريبية (المرحلة الأولى):
 * - الشركة مسجلة في الضريبة، وحساباتها في الدليل (مدينو العقود، ضريبة المخرجات، مبيعات السلع والخدمات).
 * - ثلاثة عملاء (منشأتان وفرد)، وأربعة أصناف وخدمات منها تأجير سكني معفى بسبب الهيئة.
 * - فاتورة ضريبية محصلة جزئيًا وعليها إشعار دائن، وفاتورة مبسطة محصلة بالكامل، وفاتورة إيجار معفاة غير محصلة،
 *   وفاتورة بانتظار الإصدار، ومسودة. يُعدّها المحاسب ويصدرها المدير (فصل المهام)، والتحصيل بسندات قبض تمر بمراحل اعتمادها.
 */
@Injectable()
export class BillingSeed {
  constructor(
    private readonly db: DataSource, private readonly ops: BillingOpsService, private readonly catalog: CatalogService,
    private readonly docs: DocumentsService, private readonly vouchers: VouchersService,
  ) {}

  private async grant(roleId: string, actor: OrgUser, list: string[]) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: roleId }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...actor, permissions: [...new Set([...actor.permissions, ...list])] } as OrgUser;
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    const account = async (nature: string, name: string) =>
      ((await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature = $2 AND name LIKE $3 ORDER BY code LIMIT 1`, [org, nature, `%${name}%`]))[0]?.id ?? null) as string | null;
    // حساب عملاء مستقل للفوترة (مدينو العقود)، لأن حساب المدينين التجاريين يستعمله متجر الأسر المنتجة في المالي
    const ar = (await account('assets', 'مدينو عقود')) ?? (await account('assets', 'مدينون تجاريون'));
    const vat = await account('liabilities', 'مخرجات');
    const revenue = await account('revenue', 'مبيعات السلع والخدمات');
    if (!ar || !vat || !revenue) return;
    const [cat] = await this.db.query(`SELECT id FROM acc_partner_categories WHERE organization_id = $1 AND behavior = 'customer' ORDER BY sort_order LIMIT 1`, [org]);
    const [bank] = await this.db.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 AND is_active AND kind = 'bank' ORDER BY name LIMIT 1`, [org]);
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);

    // المحاسب يعدّ الفواتير ويحصّلها، والمدير يصدرها
    const clerk = await this.grant(team.roles.finance, team.finance, [BP.read, BP.invoices, BP.customers, BP.items, BP.reports, ACC.receipts]);
    await this.ops.saveSettings(admin, {
      mode: 'registered', sellerName: o?.name ?? 'الشركة التجريبية', sellerNameEn: 'Reaya Watan Demo Company', vatNumber: '310000000000003', idType: 'OTH', idNumber: '1234',
      address: ADDRESS, vatRate: 15, vatEffectiveFrom: '2020-01-01', paymentCashAccountId: bank?.id ?? null, receivablesAccountId: ar, vatOutputAccountId: vat, revenueAccountId: revenue, customerCategoryId: cat?.id ?? null,
      analyticId: null, paymentDays: 30, terms: 'السداد خلال 30 يومًا من تاريخ الفاتورة بتحويل إلى حساب الشركة.',
    });

    const amal = await this.catalog.createCustomer(clerk, {
      kind: 'business', name: 'شركة الأمل للتجارة', nameEn: 'Al Amal Trading Co.', vatNumber: '300012345600003', idType: 'CRN', idNumber: '1010456789',
      address: { ...ADDRESS, street: 'طريق العليا', buildingNo: '3158', district: 'العليا', postalCode: '12214' }, phone: '0112345678', email: 'ap@alamal.example',
    });
    const birr = await this.catalog.createCustomer(clerk, {
      kind: 'business', name: 'مؤسسة البر للتدريب', vatNumber: '300098765400003', address: { ...ADDRESS, street: 'شارع التخصصي', buildingNo: '7420', district: 'المعذر', postalCode: '12331' }, phone: '0501112233',
    });
    await this.catalog.createCustomer(clerk, { kind: 'individual', name: 'أحمد بن سعد الغامدي', phone: '0559876543' });

    const training = await this.catalog.createItem(clerk, { name: 'دورة تدريبية في إدارة المتطوعين', kind: 'service', unit: 'متدرب', price: 500, vatCategory: 'S' });
    const hall = await this.catalog.createItem(clerk, { name: 'تأجير قاعة مناسبات', kind: 'service', unit: 'يوم', price: 3000, vatCategory: 'S' });
    const housing = await this.catalog.createItem(clerk, { name: 'تأجير وحدة سكنية من الوقف', kind: 'service', unit: 'شهر', price: 2500, vatCategory: 'E', reasonCode: 'VATEX-SA-30' });
    await this.catalog.createItem(clerk, { name: 'منتجات الأسر المنتجة', kind: 'product', unit: 'سلة', price: 150, vatCategory: 'S' });
    if (!amal || !birr || !training || !hall || !housing) return;

    const monthStart = `${daysAgo(0).slice(0, 8)}01`;
    const d = (n: number) => (daysAgo(n) < monthStart ? monthStart : daysAgo(n));
    const issue = async (id: string, date: string) => {
      await this.docs.submit(clerk, id);
      return this.docs.issue(admin, id, { date });
    };
    const collect = async (id: string, date: string, amount: number, approve: boolean) => {
      if (!bank) return;
      const r = await this.docs.collect(clerk, id, { date, method: 'transfer', cashAccountId: bank.id, amount, note: null });
      const v = r.receipts[r.receipts.length - 1];
      if (approve && v) {
        // سندات القبض الآلية تدخل مراحل الاعتماد مباشرة إن وُجدت، فيعتمدها المدير مرحلة مرحلة
        let status = v.status;
        if (status === 'draft') status = (await this.vouchers.submit(admin, v.id)).status;
        for (let i = 0; i < 5 && status === 'pending'; i++) status = (await this.vouchers.decide(admin, v.id, { decision: 'approve' })).status;
      }
    };

    // 1) فاتورة ضريبية لشركة الأمل: دورة لعشرة متدربين وتأجير قاعة، ثم إشعار دائن لمتدرب انسحب، وتحصيل جزئي
    const inv1 = await this.docs.create(clerk, {
      kind: 'invoice', customerId: amal.id, supplyDate: d(6), notes: 'دورة إدارة المتطوعين لموظفي الشركة مع قاعة الحفل الختامي',
      lines: [{ itemId: training.id, qty: 10, unitPrice: 500, discount: 250 }, { itemId: hall.id, qty: 1, unitPrice: 3000 }],
    });
    const issued1 = await issue(inv1.id, d(6));
    const cn = await this.docs.create(clerk, {
      kind: 'credit_note', refId: inv1.id, reason: 'انسحاب متدرب قبل بدء الدورة', lines: [{ refLineId: issued1.lines[0].id, qty: 1, unitPrice: 475 }],
    });
    await issue(cn.id, d(4));
    await collect(inv1.id, d(3), 5000, true);

    // 2) فاتورة مبسطة لفرد: تأجير القاعة ليوم، محصلة بالكامل
    const inv2 = await this.docs.create(clerk, { kind: 'invoice', buyerName: 'خالد العتيبي', lines: [{ itemId: hall.id, qty: 1, unitPrice: 3000 }] });
    const issued2 = await issue(inv2.id, d(2));
    await collect(inv2.id, d(2), issued2.total, true);

    // 3) فاتورة إيجار سكني معفاة لمؤسسة البر، غير محصلة (سند قبض بانتظار الاعتماد)
    const inv3 = await this.docs.create(clerk, { kind: 'invoice', customerId: birr.id, lines: [{ itemId: housing.id, qty: 1, unitPrice: 2500 }] });
    await issue(inv3.id, d(1));
    await collect(inv3.id, d(0), 1000, false);

    // 4) فاتورة بانتظار الإصدار، و5) مسودة
    const inv4 = await this.docs.create(clerk, { kind: 'invoice', customerId: birr.id, lines: [{ itemId: training.id, qty: 4, unitPrice: 500 }] });
    await this.docs.submit(clerk, inv4.id);
    await this.docs.create(clerk, { kind: 'invoice', customerId: amal.id, notes: 'عرض لدورة ثانية بانتظار موافقة العميل', lines: [{ itemId: training.id, qty: 15, unitPrice: 500 }] });
  }
}
