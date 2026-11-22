import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RiskMethodology } from '../../risk/entities/risk.entity';
import { RiskCore } from '../../risk/risk-core.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

/** المخاطر والتغيير والالتزام: سجل المنهجيات المقترحة، ودليل المصطلحات ومكتبة المخاطر الشائعة */
@Injectable()
export class RiskStarter implements StarterPack {
  readonly module = 'risk';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly core: RiskCore) {
    this.steps = [
      {
        key: 'methodologies', label: 'سجل المنهجيات',
        detail: 'خمس منهجيات مقترحة كإصدار أول: إدارة المخاطر (ISO 31000)، استمرارية الأعمال (ISO 22301)، إدارة التغيير، الالتزام (ISO 37301)، هندسة الإجراءات.',
        run: async (a) => {
          if (await this.db.getRepository(RiskMethodology).exists({ where: { organizationId: a.organizationId } })) return existing('السجل فيه منهجيات');
          const r = await this.core.installMethodologies(a);
          return added(r.items.length);
        },
      },
      {
        key: 'guide', label: 'دليل المصطلحات ومكتبة المخاطر',
        detail: 'مصطلحات إدارة المخاطر بتعريفاتها، ومكتبة بالمخاطر الشائعة تختار منها عند تسجيل المخاطر وتعدّلها بما يناسب الشركة.',
        run: async (a) => {
          const s = await this.core.settings(a.organizationId);
          if (s.guideInstalled) return existing('الدليل منصّب');
          return added((await this.core.guide(a)).length);
        },
      },
    ];
  }
}
