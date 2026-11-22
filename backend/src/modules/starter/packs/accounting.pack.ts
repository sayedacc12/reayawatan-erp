import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { AccountsService } from '../../accounting/accounts.service';
import { Account, CashAccount } from '../../accounting/entities/accounting.entity';
import { MastersService } from '../../accounting/masters.service';
import { VouchersService } from '../../accounting/vouchers.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

/** النظام المالي: دليل الحسابات ومراكز التكلفة، ومراحل اعتماد السندات، والصندوق الرئيسي، وتصنيفات العملاء والموردين */
@Injectable()
export class AccountingStarter implements StarterPack {
  readonly module = 'accounting';
  readonly steps: StarterStep[];

  constructor(
    private readonly db: DataSource,
    private readonly accounts: AccountsService,
    private readonly masters: MastersService,
    private readonly vouchers: VouchersService,
  ) {
    this.steps = [
      {
        key: 'chart', label: 'دليل الحسابات ومراكز التكلفة',
        detail: 'دليل الحسابات المعتمد في النظام بكل مستوياته (حسابات العملاء والإيرادات والضريبة والمصروفات)، ومراكز التكلفة، وحساب إقفال النتائج. يُضاف فقط إن كان الدليل فارغًا، وتعدّل أسماء الحسابات أو تضيف حسابات الشركة بعده.',
        run: async (a) => {
          if (await this.db.getRepository(Account).exists({ where: { organizationId: a.organizationId } })) return existing('الدليل فيه حسابات');
          const r = await this.accounts.installChart(a);
          return added(r.installed);
        },
      },
      {
        key: 'stages', label: 'مراحل اعتماد سندات القبض والصرف',
        detail: 'القبض: مراجعة المحاسب ثم اعتماد المدير العام. الصرف: اعتماد المدير المالي ثم اعتماد المدير العام. اربط كل مرحلة بدورها من الإعدادات حتى لا يعتمد الشخص نفسه المرحلتين.',
        run: async (a) => {
          let n = 0;
          const sets = {
            receipt: [
              { name: 'مراجعة المحاسب', instructions: 'طابق المبلغ مع كشف البنك أو الإيصال', roleId: null },
              { name: 'اعتماد المدير العام', instructions: null, roleId: null },
            ],
            payment: [
              { name: 'اعتماد المدير المالي', instructions: 'تأكد من وجود الفاتورة وأمر الصرف', roleId: null },
              { name: 'اعتماد المدير العام', instructions: null, roleId: null },
            ],
          } as const;
          for (const kind of ['receipt', 'payment'] as const) {
            if ((await this.vouchers.stages(a.organizationId, kind)).length) continue;
            await this.vouchers.saveStages(a, kind, { stages: sets[kind].map((s) => ({ ...s })) });
            n += sets[kind].length;
          }
          return n ? added(n) : existing('المراحل محددة');
        },
      },
      {
        key: 'cash', label: 'الصندوق الرئيسي',
        detail: 'صندوق نقدية باسم «الصندوق الرئيسي» مرتبط بحساب الصندوق في الدليل. تضيف البنوك بأرقام حساباتها لاحقًا.',
        run: async (a) => this.cashBox(a),
      },
      {
        key: 'categories', label: 'تصنيفات العملاء والموردين',
        detail: 'تصنيفا «عملاء» و«موردون» لدليل الشركاء.',
        run: async (a) => {
          const before = (await this.db.query('SELECT count(*)::int AS n FROM acc_partner_categories WHERE organization_id = $1', [a.organizationId]))[0].n as number;
          const after = (await this.masters.listCategories(a)).length;
          return after > before ? added(after - before) : existing();
        },
      },
    ];
  }

  private async cashBox(a: OrgUser) {
    const org = a.organizationId;
    if (await this.db.getRepository(CashAccount).exists({ where: { organizationId: org, kind: 'cash' } })) return existing('يوجد صندوق');
    // أول حساب ترحيل تحت «الصندوق» في الدليل، غير مرتبط ببنك أو صندوق آخر
    const [gl] = await this.db.query(
      `SELECT a.id FROM acc_accounts a
        WHERE a.organization_id = $1 AND a.kind = 'sub' AND a.is_active AND a.code LIKE '11103%'
          AND NOT EXISTS (SELECT 1 FROM acc_cash_accounts c WHERE c.organization_id = $1 AND c.gl_account_id = a.id)
        ORDER BY a.code LIMIT 1`, [org]);
    if (!gl) return { added: 0, note: 'لم يُعثر على حساب الصندوق في الدليل، فأضف الصندوق يدويًا من شاشة البنوك والصناديق' };
    await this.masters.createCash(a, { kind: 'cash', name: 'الصندوق الرئيسي', glAccountId: gl.id, description: 'أُضيف ضمن الإعدادات الافتراضية' });
    return added(1);
  }
}
