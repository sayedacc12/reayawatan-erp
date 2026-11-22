import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditArea } from '../../audit/entities/audit.entity';
import { PlanningService } from '../../audit/planning.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

/** [الرمز، الاسم، التصنيف، اسم الوحدة في الهيكل، الاحتمال، الأثر، الوصف] */
const AREAS: [string, string, string, string, number, number, string][] = [
  ['FIN-01', 'المدفوعات والصرف', 'financial', 'إدارة الشؤون المالية والإدارية', 4, 4, 'دورة الصرف من الطلب حتى سند الصرف والمستندات المؤيدة'],
  ['FIN-02', 'العهد النقدية والصندوق', 'financial', 'إدارة الشؤون المالية والإدارية', 3, 3, 'العهد المستديمة وتسويتها والجرد المفاجئ للصندوق'],
  ['REV-01', 'الفوترة والتحصيل من العملاء', 'financial', 'إدارة الشؤون المالية والإدارية', 4, 4, 'إصدار الفواتير الضريبية في موعدها، ومتابعة الذمم المتأخرة، وصحة الإيراد المسجل'],
  ['TAX-01', 'الالتزامات الزكوية والضريبية', 'compliance', 'إدارة الشؤون المالية والإدارية', 3, 4, 'إقرارات ضريبة القيمة المضافة والزكاة ومتطلبات الفوترة الإلكترونية'],
  ['BD-01', 'العروض الفنية والمالية والتعاقد', 'operational', 'إدارة تطوير الأعمال والعملاء', 3, 4, 'اعتماد العروض والتسعير، ومراجعة شروط العقود قبل توقيعها مع العميل'],
  ['PRJ-01', 'تنفيذ التكليفات الاستشارية', 'operational', 'إدارة الاستشارات والمشاريع', 3, 4, 'الالتزام بنطاق التكليف وجدوله، وجودة المخرجات، وتسليمها واعتمادها من العميل'],
  ['PRC-01', 'المشتريات والتعاقد مع المستشارين المستقلين', 'operational', 'إدارة الشؤون المالية والإدارية', 3, 3, 'طلبات الشراء والعروض والترسية، والتعاقد مع المستشارين المستقلين ومتابعة أعمالهم'],
  ['HR-01', 'الرواتب والتعيين', 'hr', 'إدارة الشؤون المالية والإدارية', 3, 4, 'مسير الرواتب والحضور والتعيين وفق خطة التعيين'],
  ['IT-01', 'أمن المعلومات وسرية بيانات العملاء', 'it', 'الإدارة العامة', 3, 5, 'صلاحيات المستخدمين وحماية بيانات العملاء ووثائقهم'],
  ['GOV-01', 'قرارات المالك ومجلس المديرين', 'governance', 'الإدارة العامة', 2, 3, 'توثيق القرارات وتفويض الصلاحيات ومتابعة تنفيذها'],
];

/** المراجعة الداخلية: عالم المراجعة (مجالات المراجعة الشائعة في شركات الاستشارات بتقييم مبدئي لمخاطرها) */
@Injectable()
export class AuditStarter implements StarterPack {
  readonly module = 'audit';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly planning: PlanningService) {
    this.steps = [
      {
        key: 'areas', label: 'مجالات المراجعة (عالم المراجعة)',
        detail: 'عشرة مجالات شائعة في شركات الاستشارات: المدفوعات، العهد والصندوق، الفوترة والتحصيل، الزكاة والضريبة، العروض والتعاقد، تنفيذ التكليفات، المشتريات والمستشارين المستقلين، الرواتب، أمن المعلومات وسرية بيانات العملاء، قرارات المالك ومجلس المديرين، بتقييم مبدئي للاحتمال والأثر تعدّله بعد الدراسة.',
        run: async (a) => {
          const org = a.organizationId;
          if (await this.db.getRepository(AuditArea).exists({ where: { organizationId: org } })) return existing('عالم المراجعة فيه مجالات');
          const units: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1', [org]).catch(() => []);
          const unitId = (name: string) => units.find((u) => u.name === name)?.id ?? null;
          for (const [code, name, category, unit, likelihood, impact, description] of AREAS) {
            const id = unitId(unit);
            // إن لم تكن الوحدة في الهيكل بعد، يُكتب اسمها نصًا ويمكن ربطها بالهيكل لاحقًا
            await this.planning.createArea(a, {
              code, name, category, scopeType: id ? 'unit' : 'outside', unitId: id, outsideLabel: id ? null : unit,
              description, likelihood, impact, controlRating: 'unknown', lastAuditDate: null, riskRefs: [],
            });
          }
          return added(AREAS.length);
        },
      },
    ];
  }
}
