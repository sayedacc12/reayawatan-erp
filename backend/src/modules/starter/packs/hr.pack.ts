import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HrCompetency, HrGrade, HrUnit } from '../../hr/entities/hr.entity';
import { OrgService } from '../../hr/org.service';
import { StarterPack, StarterStep, added, existing } from '../starter.types';

const lv = (d: string[]) => d.map((description, i) => ({ level: i + 1, description }));

const COMPETENCIES: { name: string; kind: 'core' | 'leadership' | 'technical'; description: string; levels: string[] }[] = [
  { name: 'النزاهة والسرية المهنية', kind: 'core', description: 'الالتزام بالقيم والأنظمة وحماية بيانات العملاء ومعلوماتهم',
    levels: ['يلتزم بالتعليمات عند التذكير', 'يلتزم بالأنظمة في عمله اليومي', 'يحافظ على سرية معلومات العملاء ويبلّغ عن المخالفات', 'قدوة لزملائه في النزاهة', 'يرسّخ ثقافة النزاهة في الشركة'] },
  { name: 'التركيز على العميل', kind: 'core', description: 'فهم احتياج العميل وتقديم قيمة واضحة له في كل تكليف',
    levels: ['يستجيب لطلبات العميل المباشرة', 'يفهم احتياج العميل ويوضح له ما سيُقدَّم', 'يتابع رضا العميل حتى إغلاق التكليف', 'يبني علاقة ثقة طويلة مع العميل', 'يقود ثقافة التركيز على العميل في الشركة'] },
  { name: 'التواصل والعرض', kind: 'core', description: 'إيصال الأفكار والنتائج بوضوح، كتابة وعرضًا، والإنصات للآخرين',
    levels: ['يتواصل بشكل محدود', 'ينقل المعلومات بوضوح', 'يكتب تقارير واضحة ويكيّف أسلوبه حسب المستمع', 'يقدم عروضًا مقنعة للعملاء ويدير الحوارات الصعبة', 'يمثل الشركة في المحافل بكفاءة'] },
  { name: 'العمل بروح الفريق', kind: 'core', description: 'التعاون وتبادل المعرفة لتحقيق أهداف التكليف والشركة',
    levels: ['يتعاون عند الطلب', 'يشارك المعلومات مع زملائه', 'يبادر بمساعدة الفريق', 'يبني تعاونًا بين فرق المشاريع', 'يقود ثقافة العمل الجماعي'] },
  { name: 'التفكير التحليلي وحل المشكلات', kind: 'technical', description: 'جمع البيانات وتحليلها والوصول إلى توصيات عملية قابلة للتنفيذ',
    levels: ['يجمع البيانات المطلوبة', 'يحلل البيانات بأدوات مناسبة', 'يستخلص النتائج ويقترح حلولًا', 'يبني توصيات مدعومة بالأدلة للعميل', 'يطوّر منهجيات التحليل في الشركة'] },
  { name: 'إدارة المشاريع والتكليفات', kind: 'leadership', description: 'تخطيط التكليف ومتابعة نطاقه وجدوله وجودة مخرجاته',
    levels: ['ينظم مهامه في التكليف', 'يلتزم بمواعيد مخرجاته', 'يدير مشروعًا صغيرًا بنطاقه وجدوله', 'يدير عدة مشاريع ومخاطرها مع العميل', 'يقود محفظة المشاريع ويطور أسلوب إدارتها'] },
  { name: 'اتخاذ القرار', kind: 'leadership', description: 'تحليل البدائل واتخاذ القرار المناسب في وقته',
    levels: ['يرجع لمديره في كل قرار', 'يتخذ القرارات الروتينية', 'يتخذ قرارات مدروسة في نطاقه', 'يتخذ قرارات معقدة بثقة', 'يتخذ قرارات استراتيجية'] },
];

/** الموارد البشرية: هيكل تنظيمي مبدئي، وسلم رواتب مقترح، وقاموس جدارات */
@Injectable()
export class HrStarter implements StarterPack {
  readonly module = 'hr';
  readonly steps: StarterStep[];

  constructor(private readonly db: DataSource, private readonly org: OrgService) {
    this.steps = [
      {
        key: 'structure', label: 'الهيكل التنظيمي المبدئي',
        detail: 'الإدارة العامة، وتحتها: إدارة الاستشارات والمشاريع، وإدارة تطوير الأعمال والعملاء، وإدارة الشؤون المالية والإدارية. يُضاف فقط إن كان الهيكل فارغًا.',
        run: async (a) => {
          if (await this.db.getRepository(HrUnit).exists({ where: { organizationId: a.organizationId } })) return existing('الهيكل فيه وحدات');
          const top = await this.org.createUnit(a, { name: 'الإدارة العامة', level: 0, parentId: null });
          for (const name of ['إدارة الاستشارات والمشاريع', 'إدارة تطوير الأعمال والعملاء', 'إدارة الشؤون المالية والإدارية']) {
            await this.org.createUnit(a, { name, level: 1, parentId: top.id });
          }
          return added(4);
        },
      },
      {
        key: 'grades', label: 'سلم الرواتب',
        detail: 'ست مراتب من «مساعد إداري» حتى «المدير العام» مرورًا بالمستشار والمستشار الأول ومدير المشروع، بحدود رواتب مقترحة، وبدل سكن 25% ونقل 10%. عدّل المبالغ بما يناسب شركتك.',
        run: async (a) => {
          if (await this.db.getRepository(HrGrade).exists({ where: { organizationId: a.organizationId } })) return existing('السلم فيه مراتب');
          const allowances = [
            { code: 'housing', name: 'بدل السكن', kind: 'percent' as const, value: 25 },
            { code: 'transport', name: 'بدل النقل', kind: 'percent' as const, value: 10 },
          ];
          const grades: [string, string, number, number, number, number][] = [
            ['G1', 'مساعد إداري', 2, 4500, 7000, 6], ['G2', 'مستشار', 2, 8000, 12000, 8], ['G3', 'مستشار أول', 2, 12000, 17000, 8],
            ['G4', 'مدير مشروع', 2, 15000, 21000, 6], ['G5', 'مدير إدارة', 1, 19000, 27000, 6], ['G6', 'المدير العام', 0, 26000, 38000, 5],
          ];
          for (const [i, [code, name, structureLevel, minSalary, maxSalary, steps]] of grades.entries()) {
            await this.org.createGrade(a, { code, name, structureLevel, minSalary, maxSalary, steps, stepIncrement: 4, allowances, sortOrder: i + 1 });
          }
          return added(grades.length);
        },
      },
      {
        key: 'competencies', label: 'قاموس الجدارات',
        detail: 'أربع جدارات أساسية (النزاهة والسرية، التركيز على العميل، التواصل والعرض، العمل بروح الفريق)، وجدارة فنية للتحليل وحل المشكلات، وجدارتان قياديتان (إدارة المشاريع، اتخاذ القرار)، لكل منها خمسة مستويات موصوفة.',
        run: async (a) => {
          if (await this.db.getRepository(HrCompetency).exists({ where: { organizationId: a.organizationId } })) return existing('القاموس فيه جدارات');
          for (const c of COMPETENCIES) await this.org.createCompetency(a, { name: c.name, kind: c.kind, description: c.description, levels: lv(c.levels) });
          return added(COMPETENCIES.length);
        },
      },
    ];
  }
}
