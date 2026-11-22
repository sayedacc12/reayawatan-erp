import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PrSettings, PrWarehouse } from '../../procurement/entities/procurement.entity';
import { ProcurementCore } from '../../procurement/procurement-core.service';
import { WarehousesService } from '../../procurement/warehouses.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

/** المشتريات والمستودعات: القوائم الأساسية (وحدات القياس، مجموعات الأصناف، تصنيفات الموردين ومستنداتهم)، والمستودع الرئيسي */
@Injectable()
export class ProcurementStarter implements StarterPack {
  readonly module = 'procurement';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly warehouses: WarehousesService) {
    this.steps = [
      {
        key: 'lists', label: 'القوائم الأساسية للمشتريات',
        detail: 'وحدات القياس (حبة، كرتون، كيلوجرام...)، ومجموعات الأصناف، وتصنيفات الموردين وأنشطتهم، والمستندات المطلوبة منهم، ومصفوفة اعتماد التعميدات ومعايير تقييم العروض.',
        run: async (a) => {
          if (await this.db.getRepository(PrSettings).exists({ where: { organizationId: a.organizationId } })) return existing('القوائم مضافة');
          await this.core.settings(a.organizationId);
          const [{ n }] = await this.db.query(
            `SELECT (SELECT count(*) FROM pr_uoms WHERE organization_id = $1) + (SELECT count(*) FROM pr_item_groups WHERE organization_id = $1)
                  + (SELECT count(*) FROM pr_supplier_categories WHERE organization_id = $1) AS n`, [a.organizationId]);
          return added(Number(n));
        },
      },
      {
        key: 'warehouse', label: 'المستودع الرئيسي',
        detail: 'مستودع رئيسي باسم «المستودع الرئيسي» تضيف له المواقع وأمناء المستودع لاحقًا.',
        run: async (a) => {
          if (await this.db.getRepository(PrWarehouse).exists({ where: { organizationId: a.organizationId } })) return existing('يوجد مستودع');
          const s = await this.core.settings(a.organizationId);
          if (s.accountLevel === 'warehouse') return { added: 0, note: 'حسابات المخزون محددة على مستوى المستودع، فأضف المستودع يدويًا مع حسابه' };
          await this.warehouses.create(a, { name: 'المستودع الرئيسي', kind: 'main', notes: 'أُضيف ضمن الإعدادات الافتراضية' });
          return added(1);
        },
      },
    ];
  }
}
