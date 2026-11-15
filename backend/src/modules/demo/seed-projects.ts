import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectSettings } from '../projects/entities';
import { ProjectFieldsDto } from '../projects/projects.dto';
import { ProjectsService } from '../projects/projects.service';
import { DemoTeam, DemoTree, daysAgo, daysAhead } from './demo-context';

/** المشاريع الإضافية التي تحتاجها مراحل الصرف العام والتشغيلي */
export interface DemoExtraProjects {
  operations: string;
  awareness: string;
}

/**
 * نظام إدارة المشاريع: مراحل الاعتماد، بيانات كل مشروع، واعتماد المشاريع عبر مراحلها،
 * مع أمثلة لمشروع قيد الاعتماد ومشروع معاد للتعديل ومسودة.
 */
@Injectable()
export class ProjectsSeed {
  constructor(private readonly db: DataSource, private readonly projects: ProjectsService) {}

  async run(team: DemoTeam, tree: DemoTree): Promise<DemoExtraProjects> {
    const pm = team.projectsManager;
    const org = pm.organizationId;
    await this.projects.saveStages(team.admin, {
      stages: [
        { name: 'مراجعة مدير المشاريع', instructions: 'تأكد من اكتمال بيانات المشروع وأهدافه وميزانيته', roleId: team.roles.projectsManager },
        { name: 'اعتماد المدير التنفيذي', instructions: 'الاعتماد النهائي للمشروع' },
      ],
    });
    await this.db.getRepository(ProjectSettings).save({
      organizationId: org, expenseDebitCode: '5100', expenseDebitName: 'مصروفات المشاريع',
      paymentCreditCode: '1111', paymentCreditName: 'البنك - مصرف الراجحي',
    });
    await this.projects.ensureProfiles(org);

    const year = { startDate: daysAgo(60), endDate: daysAhead(305), durationType: 'annual' as const, fiscalYear: new Date().getFullYear() };
    const ongoing = { durationType: 'continuous' as const, fiscalYear: null };
    const details: [string, ProjectFieldsDto][] = [
      [tree.projects.orphans, { managerName: 'ريم الدوسري', budget: 360000, targetBeneficiaries: 30, goals: 'كفالة 30 يتيمًا كفالة شهرية مستمرة', ...ongoing, startDate: daysAgo(60),
        idea: 'أيتام في أسر متعففة لا يكفي دخلها لتعليمهم ورعايتهم، فتكفلهم الجمعية شهريًا حتى بلوغ سن الرشد.',
        targetGroups: 'الأيتام دون 18 سنة في الأسر المسجلة', location: 'الرياض',
        outcomes: 'انتظام الأيتام في الدراسة وتحسن مستوى معيشة أسرهم',
        phases: [{ name: 'حصر الأيتام ودراسة الحالات', deliverables: 'قائمة معتمدة' }, { name: 'صرف الكفالات الشهرية', deliverables: 'كشوف الصرف' }, { name: 'المتابعة الدورية', deliverables: 'تقارير ربع سنوية' }],
        kpis: [{ name: 'عدد الأيتام المكفولين', baseline: 0, target: 30, unit: 'يتيم' }, { name: 'نسبة الانتظام الدراسي', baseline: 70, target: 95, unit: '%' }],
        budgetLines: [{ item: 'الكفالة الشهرية', quantity: 360, unitCost: 1000, amount: 360000 }],
        risks: 'تأخر وصول التبرعات: تُغطى من الأوقاف مؤقتًا' }],
      [tree.projects.widows, { managerName: 'ريم الدوسري', budget: 240000, targetBeneficiaries: 20, goals: 'دعم 20 أرملة معيلة شهريًا', idea: 'سدّ احتياج قائم: دعم 20 أرملة معيلة شهريًا', ...year }],
      [tree.projects.ramadan, { managerName: 'خالد إبراهيم', budget: 60000, targetBeneficiaries: 200, goals: 'توزيع 200 سلة غذائية خلال شهر رمضان', idea: 'سدّ احتياج قائم: توزيع 200 سلة غذائية خلال شهر رمضان', ...year }],
      [tree.projects.surgery, { managerName: 'ريم الدوسري', budget: 150000, targetBeneficiaries: 6, goals: 'المساهمة في تكاليف 6 عمليات جراحية', idea: 'سدّ احتياج قائم: المساهمة في تكاليف 6 عمليات جراحية', ...year }],
      [tree.projects.school, { managerName: 'خالد إبراهيم', budget: 45000, targetBeneficiaries: 30, goals: 'تجهيز 30 طالبًا وطالبة للعام الدراسي', idea: 'سدّ احتياج قائم: تجهيز 30 طالبًا وطالبة للعام الدراسي', ...year }],
    ];
    for (const [id, dto] of details) {
      await this.projects.updateNode(pm, id, dto);
      await this.approve(team, id);
    }

    // مشروع تشغيلي بصرف عام (غير مرتبط بمستفيدين)
    const opsAxis = await this.projects.createNode(pm, { level: 'axis', name: 'التشغيل والاستدامة' });
    const opsProgram = await this.projects.createNode(pm, { level: 'program', name: 'المصاريف التشغيلية', parentId: opsAxis!.id });
    const operations = await this.projects.createNode(pm, {
      level: 'project', parentId: opsProgram!.id, name: 'تشغيل مقر الجمعية', description: 'الإيجار والكهرباء والاتصالات ورواتب الإداريين',
      fundingType: 'operational', spendingMode: 'general', managerName: 'عبدالله الشهري', budget: 120000, goals: 'استمرار تشغيل المقر طوال العام', idea: 'سدّ احتياج قائم: استمرار تشغيل المقر طوال العام', ...year,
    });
    await this.approve(team, operations!.id);

    // مشروع مقيد بصرف عام
    const awarenessProgram = await this.projects.createNode(pm, { level: 'program', name: 'التوعية الصحية', parentId: tree.axes.health });
    const awareness = await this.projects.createNode(pm, {
      level: 'project', parentId: awarenessProgram!.id, name: 'حملة التوعية بمرض السكري', description: 'فعاليات توعوية وفحص مجاني للسكري في الأحياء',
      fundingType: 'restricted', spendingMode: 'general', managerName: 'ريم الدوسري', budget: 15000, targetBeneficiaries: 500,
      goals: 'فحص 500 شخص وتوعيتهم بمرض السكري', idea: 'سدّ احتياج قائم: فحص 500 شخص وتوعيتهم بمرض السكري', ...year,
    });
    await this.approve(team, awareness!.id);

    // قيد الاعتماد: وافق مدير المشاريع وينتظر المدير التنفيذي
    const housingProgram = await this.projects.createNode(pm, { level: 'program', name: 'الإسكان', parentId: tree.axes.social });
    const housing = await this.projects.createNode(pm, {
      level: 'project', parentId: housingProgram!.id, name: 'ترميم منازل الأسر المتعففة', description: 'ترميم وصيانة منازل الأسر المستحقة',
      fundingType: 'restricted', zakatEligible: true, managerName: 'ريم الدوسري', budget: 200000, targetBeneficiaries: 10,
      goals: 'ترميم 10 منازل خلال العام', idea: 'سدّ احتياج قائم: ترميم 10 منازل خلال العام', ...year,
      services: [{ name: 'ترميم كامل', cost: 20000 }, { name: 'صيانة كهرباء وسباكة', cost: 5000 }],
    });
    await this.projects.submit(pm, housing!.id);
    await this.projects.decide(pm, housing!.id, { decision: 'approve', note: 'البيانات مكتملة' });

    // معاد للتعديل من المرحلة الأولى
    const training = await this.projects.createNode(pm, {
      level: 'project', parentId: tree.programs.students, name: 'دورات التأهيل المهني', description: 'دورات مهنية لأبناء الأسر المستفيدة',
      fundingType: 'restricted', managerName: 'خالد إبراهيم', ...year,
      idea: 'أبناء الأسر المستفيدة يحتاجون مهارات مهنية تساعدهم على العمل', goals: 'تأهيل أبناء الأسر لسوق العمل',
    });
    await this.projects.submit(pm, training!.id);
    await this.projects.decide(pm, training!.id, { decision: 'return', note: 'حدد الميزانية وعدد المستفيدين المستهدفين قبل الاعتماد' });

    // مسودة لم تُرسل
    await this.projects.createNode(pm, {
      level: 'project', parentId: tree.programs.food, name: 'سقيا الماء', description: 'توزيع مياه الشرب على الأسر في الصيف',
      fundingType: 'restricted', zakatEligible: true, managerName: 'خالد إبراهيم', budget: 25000,
    });

    // مشروع وقف ضمن قائمة المشاريع (تستقبله تبرعات الأوقاف)
    const waqf = await this.projects.createNode(pm, {
      level: 'project', parentId: opsProgram!.id, name: 'وقف العمارة السكنية', description: 'عمارة يُصرف ريعها على مشاريع الجمعية',
      fundingType: 'endowment', spendingMode: 'general', managerName: 'عبدالله الشهري', budget: 2000000, ...ongoing,
      idea: 'وقف استثماري يوفر دخلًا ثابتًا يغطي جزءًا من مصاريف الجمعية', goals: 'شراء عمارة سكنية وتأجيرها',
    });
    await this.approve(team, waqf!.id);

    return { operations: operations!.id, awareness: awareness!.id };
  }

  /** إرسال المشروع للاعتماد ثم موافقة المرحلتين */
  private async approve(team: DemoTeam, id: string) {
    await this.projects.submit(team.projectsManager, id);
    await this.projects.decide(team.projectsManager, id, { decision: 'approve', note: 'البيانات مكتملة' });
    await this.projects.decide(team.admin, id, { decision: 'approve', note: 'معتمد' });
  }
}
