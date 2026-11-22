import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { MastersService } from '../../accounting/masters.service';
import { BillingCore } from '../../billing/billing-core.service';
import { BillingOpsService } from '../../billing/billing-ops.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

/** الحسابات المقترحة من الدليل: أول حساب فرعي نشط يبدأ رمزه بالبادئة وله الطبيعة المطلوبة */
const LINKS = [
  { field: 'receivablesAccountId', prefix: '11402001', nature: 'assets' },
  { field: 'vatOutputAccountId', prefix: '21305001', nature: 'liabilities' },
  { field: 'revenueAccountId', prefix: '31205002', nature: 'revenue' },
] as const;

/**
 * الفوترة والمبيعات: ربط الإعدادات بحسابات الدليل وتصنيف العملاء، لتبدأ الشركة فوترة خدماتها الاستشارية مباشرة.
 * لا يغيّر وضع الشركة الضريبي ولا بياناتها الضريبية، ولا يعمل إن كانت مربوطة مع «فاتورة» أو بدأت الربط.
 */
@Injectable()
export class BillingStarter implements StarterPack {
  readonly module = 'billing';
  readonly steps: StarterStep[];

  constructor(
    private readonly db: DataSource,
    private readonly core: BillingCore,
    private readonly ops: BillingOpsService,
    private readonly masters: MastersService,
  ) {
    this.steps = [{
      key: 'accounts', label: 'ربط الفوترة بحسابات الدليل',
      detail: 'حساب العملاء (مدينون تجاريون)، وحساب ضريبة القيمة المضافة (مخرجات)، وحساب إيراد بيع الخدمات، وتصنيف «عملاء». يُربط الناقص فقط، ولا يتغير وضع الشركة الضريبي ولا بياناتها الضريبية.',
      run: async (a) => this.linkAccounts(a),
    }];
  }

  private async linkAccounts(a: OrgUser) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    if (s.mode === 'integrated') return existing('الشركة مربوطة مع «فاتورة»، فتُعدّل إعداداتها من شاشة الربط');
    const fill: Partial<Record<(typeof LINKS)[number]['field'] | 'customerCategoryId', string>> = {};
    for (const l of LINKS) {
      if (s[l.field]) continue;
      const [acc] = await this.db.query(
        `SELECT id FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature = $2 AND code LIKE $3 ORDER BY code LIMIT 1`,
        [org, l.nature, l.prefix + '%']);
      if (acc) fill[l.field] = acc.id;
    }
    if (!s.customerCategoryId) {
      const cat = (await this.masters.listCategories(a)).find((c: { behavior: string }) => c.behavior === 'customer') as { id: string } | undefined;
      if (cat) fill.customerCategoryId = cat.id;
    }
    const n = Object.keys(fill).length;
    if (!n) {
      const [{ any }] = await this.db.query('SELECT EXISTS (SELECT 1 FROM acc_accounts WHERE organization_id = $1) AS any', [org]);
      return any ? existing('الحسابات مربوطة') : { added: 0, note: 'الدليل المحاسبي فارغ، فأضف الإعدادات الافتراضية للنظام المالي أولًا ثم اربط الحسابات من هنا' };
    }
    // الحفظ عبر خدمة الفوترة: الناقص فقط داخل معاملة مع قفل الصف، مع سجل التعديلات
    const linked = await this.ops.linkDefaults(a, fill);
    if (linked === null) return existing('الشركة بدأت الربط مع «فاتورة»، فتُعدّل إعداداتها من شاشة الربط');
    return linked ? added(linked) : existing('الحسابات مربوطة');
  }
}
