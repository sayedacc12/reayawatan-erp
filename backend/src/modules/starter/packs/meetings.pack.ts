import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MtgBody } from '../../meetings/entities/meetings.entity';
import { MeetingsService } from '../../meetings/meetings.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

const BODIES = [
  { kind: 'general_assembly' as const, code: 'OWN', name: 'قرارات المالك', description: 'قرارات الشريك المالك للشركة: اعتماد القوائم المالية وتعيين المديرين وتعديل عقد التأسيس', quorumPercent: 100, isConfidential: false },
  { kind: 'board' as const, code: 'BRD', name: 'مجلس المديرين', description: 'مجلس المديرين للدورة الحالية: يعتمد الخطة والموازنة ويتابع أداء الشركة', quorumPercent: 60, isConfidential: false },
  { kind: 'committee' as const, code: 'MGT', name: 'لجنة الإدارة التنفيذية', description: 'تتابع تنفيذ الخطة التشغيلية والمشاريع والتحصيل أسبوعيًا أو شهريًا', quorumPercent: 50, isConfidential: false },
  { kind: 'committee' as const, code: 'ARC', name: 'لجنة المراجعة', description: 'تراجع القوائم المالية والرقابة الداخلية وتقارير المراجعة', quorumPercent: 60, isConfidential: true },
];

/** الاجتماعات واللجان: الجهات الأساسية للشركة (قرارات المالك، مجلس المديرين، لجنة الإدارة التنفيذية، لجنة المراجعة) بلا أعضاء */
@Injectable()
export class MeetingsStarter implements StarterPack {
  readonly module = 'meetings';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly meetings: MeetingsService) {
    this.steps = [
      {
        key: 'bodies', label: 'الجهات الأساسية',
        detail: 'قرارات المالك، ومجلس المديرين، ولجنة الإدارة التنفيذية، ولجنة المراجعة (سرية)، بنصاب مقترح. تضيف الأعضاء وأمين السر لكل جهة بعد ذلك، وتعطّل ما لا ينطبق على شركتك.',
        run: async (a) => {
          const org = a.organizationId;
          const have = new Set((await this.db.getRepository(MtgBody).find({ where: { organizationId: org }, select: { code: true } })).map((b) => b.code.toUpperCase()));
          let n = 0;
          for (const b of BODIES) {
            if (have.has(b.code)) continue;
            await this.meetings.saveBody(a, null, { ...b, members: [], isActive: true });
            n++;
          }
          return n ? added(n) : existing('الجهات موجودة');
        },
      },
    ];
  }
}
