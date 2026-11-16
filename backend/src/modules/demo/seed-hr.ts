import { Injectable } from '@nestjs/common';
import { HrCore, today } from '../hr/hr-core.service';
import { defaultPolicy } from '../hr/hr-policy';
import { OrgService } from '../hr/org.service';
import { PeopleService } from '../hr/people.service';
import { PerformanceService } from '../hr/performance.service';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/**
 * الموارد البشرية في الجمعية التجريبية: اللائحة، هيكل بمستويات مرنة، سلم رواتب، جدارات، أوصاف وظيفية معتمدة،
 * خطة تعيين، موظفو الجمعية التجريبية أنفسهم بعقودهم ورواتبهم، إجازات، وبطاقات أداء بمراحل مختلفة.
 * كل العمليات عبر خدمات الوحدة نفسها (بنفس التحقق).
 */
@Injectable()
export class HrSeed {
  constructor(
    private readonly core: HrCore,
    private readonly org: OrgService,
    private readonly people: PeopleService,
    private readonly perf: PerformanceService,
  ) {}

  async run(team: DemoTeam) {
    const { admin } = team;
    const year = Number(today().slice(0, 4));
    await this.core.savePolicy(admin, { policy: defaultPolicy() as unknown as Record<string, unknown>, effectiveDate: `${year}-01-01`, note: 'اعتماد مجلس الإدارة للائحة الموارد البشرية' });
    await this.core.saveSettings(admin, { structureLevels: ['المدير التنفيذي', 'إدارة', 'قسم'] });

    // ---- الهيكل: قسم الجودة يتبع المدير التنفيذي مباشرة (تسلسل مرن)
    const unit = async (name: string, level: number, parentId: string | null, costCenter?: string) =>
      (await this.org.createUnit(admin, { name, level, parentId, costCenter: costCenter ?? null })).id;
    const exec = await unit('الإدارة التنفيذية', 0, null, 'الإدارية والعمومية');
    const programs = await unit('إدارة البرامج والخدمات', 1, exec, 'البرامج');
    const social = await unit('قسم البحث الاجتماعي', 2, programs, 'البرامج');
    const projects = await unit('قسم المشاريع', 2, programs, 'البرامج');
    const resources = await unit('إدارة تنمية الموارد', 1, exec, 'جمع الأموال');
    const finAdmin = await unit('إدارة الشؤون المالية والإدارية', 1, exec, 'الإدارية والعمومية');
    const hrDept = await unit('قسم الموارد البشرية', 2, finAdmin, 'الإدارية والعمومية');
    const quality = await unit('قسم الجودة', 2, exec, 'الإدارية والعمومية');

    // ---- سلم الرواتب
    const allowances = [
      { code: 'housing', name: 'بدل السكن', kind: 'percent' as const, value: 25 },
      { code: 'transport', name: 'بدل النقل', kind: 'percent' as const, value: 10 },
    ];
    const grade = async (code: string, name: string, structureLevel: number | null, minSalary: number, maxSalary: number, steps: number, sortOrder: number) =>
      (await this.org.createGrade(admin, { code, name, structureLevel, minSalary, maxSalary, steps, stepIncrement: 4, allowances, sortOrder })).id;
    const g1 = await grade('G1', 'مساعد إداري', 2, 4000, 6000, 6, 1);
    const g2 = await grade('G2', 'أخصائي', 2, 6500, 9500, 8, 2);
    const g3 = await grade('G3', 'أخصائي أول', 2, 9000, 13000, 8, 3);
    const g4 = await grade('G4', 'رئيس قسم', 2, 11000, 16000, 6, 4);
    const g5 = await grade('G5', 'مدير إدارة', 1, 15000, 22000, 6, 5);
    const g6 = await grade('G6', 'مدير تنفيذي', 0, 22000, 32000, 5, 6);

    // ---- الجدارات
    const lv = (d: string[]) => d.map((description, i) => ({ level: i + 1, description }));
    const comp = async (name: string, kind: 'core' | 'leadership' | 'technical', description: string, levels: string[]) =>
      (await this.org.createCompetency(admin, { name, kind, description, levels: lv(levels) })).id;
    const integrity = await comp('النزاهة والأمانة', 'core', 'الالتزام بالقيم والأنظمة وحماية بيانات المستفيدين والمتبرعين', [
      'يلتزم بالتعليمات عند التذكير', 'يلتزم بالأنظمة في عمله اليومي', 'يحافظ على السرية ويبلّغ عن المخالفات', 'قدوة لزملائه في النزاهة', 'يرسّخ ثقافة النزاهة في الجمعية',
    ]);
    const communication = await comp('التواصل الفعّال', 'core', 'إيصال المعلومات بوضوح والإنصات للآخرين', [
      'يتواصل بشكل محدود', 'ينقل المعلومات بوضوح', 'يكيّف أسلوبه حسب المستمع', 'يدير الحوارات الصعبة بلباقة', 'يمثل الجمعية في المحافل بكفاءة',
    ]);
    const teamwork = await comp('العمل بروح الفريق', 'core', 'التعاون وتبادل المعرفة لتحقيق أهداف الجمعية', [
      'يتعاون عند الطلب', 'يشارك المعلومات مع زملائه', 'يبادر بمساعدة الفريق', 'يبني علاقات تعاون بين الأقسام', 'يقود ثقافة العمل الجماعي',
    ]);
    const planning = await comp('التخطيط والتنظيم', 'leadership', 'وضع الخطط وترتيب الأولويات ومتابعة التنفيذ', [
      'ينظم مهامه اليومية', 'يخطط لمهامه الأسبوعية', 'يخطط لأعمال قسمه', 'يربط خطط القسم بأهداف الجمعية', 'يقود التخطيط الاستراتيجي',
    ]);
    const decision = await comp('اتخاذ القرار', 'leadership', 'تحليل البدائل واتخاذ القرار المناسب في وقته', [
      'يرجع لمديره في كل قرار', 'يتخذ القرارات الروتينية', 'يتخذ قرارات مدروسة في نطاقه', 'يتخذ قرارات معقدة بثقة', 'يتخذ قرارات استراتيجية',
    ]);
    const caseStudy = await comp('دراسة الحالات الاجتماعية', 'technical', 'البحث الاجتماعي وتقدير الاحتياج بدقة وعدل', [
      'يجمع البيانات الأساسية', 'يعد بحثًا اجتماعيًا مكتملًا', 'يحلل الحالة ويقترح الدعم المناسب', 'يدرس الحالات المعقدة ويوجّه الزملاء', 'يطوّر أدوات البحث الاجتماعي',
    ]);
    const fundraising = await comp('تنمية الموارد المالية', 'technical', 'استقطاب المتبرعين والجهات المانحة والمحافظة عليهم', [
      'يعرف قنوات التبرع', 'يتابع المتبرعين الحاليين', 'يستقطب متبرعين جددًا', 'يكتب مقترحات المنح ويفوز بها', 'يبني شراكات مانحة طويلة المدى',
    ]);

    // ---- الأوصاف الوظيفية
    const core3 = (level: number) => [{ competencyId: integrity, level }, { competencyId: communication, level }, { competencyId: teamwork, level }];
    const job = async (title: string, unitId: string, gradeId: string, headcount: number, purpose: string, responsibilities: string[],
      kpis: { title: string; weight: number; target: string; unit?: string }[], competencies: { competencyId: string; level: number }[], reportsToJobId: string | null = null, approve = true) => {
      const id = (await this.org.createJob(admin, {
        title, unitId, gradeId, headcount, purpose, responsibilities, qualifications: 'بكالوريوس في التخصص المناسب', experienceYears: 2,
        competencies, kpis, reportsToJobId,
      })).id;
      if (approve) await this.org.approveJob(admin, id);
      return id;
    };
    const ceo = await job('المدير التنفيذي', exec, g6, 1, 'قيادة الجمعية وتحقيق أهدافها الاستراتيجية', ['تنفيذ قرارات مجلس الإدارة', 'الإشراف على الإدارات', 'تمثيل الجمعية أمام الجهات'],
      [{ title: 'تحقيق مستهدفات الخطة السنوية', weight: 50, target: '90%' }, { title: 'نمو الإيرادات', weight: 30, target: '15%' }, { title: 'رضا الموظفين', weight: 20, target: '80%' }],
      [...core3(5), { competencyId: planning, level: 5 }, { competencyId: decision, level: 5 }]);
    const programsMgr = await job('مدير البرامج والخدمات', programs, g5, 1, 'إدارة برامج الجمعية وخدمات المستفيدين', ['اعتماد الحالات', 'متابعة جودة الخدمات', 'إعداد تقارير الأثر'],
      [{ title: 'متوسط مدة إنجاز الطلب', weight: 40, target: '10', unit: 'أيام' }, { title: 'نسبة رضا المستفيدين', weight: 30, target: '85%' }, { title: 'تنفيذ البرامج في موعدها', weight: 30, target: '95%' }],
      [...core3(4), { competencyId: planning, level: 4 }, { competencyId: decision, level: 4 }], ceo);
    const researcher = await job('أخصائي اجتماعي', social, g2, 4, 'دراسة حالات المستفيدين وتقدير احتياجهم بعدالة', ['إجراء الزيارات الميدانية', 'إعداد البحث الاجتماعي', 'متابعة الحالات بعد الدعم'],
      [{ title: 'عدد الحالات المدروسة', weight: 50, target: '40', unit: 'حالة' }, { title: 'دقة البحث (حالات غير مُرجعة)', weight: 30, target: '90%' }, { title: 'الالتزام بمدة الدراسة', weight: 20, target: '7', unit: 'أيام' }],
      [...core3(3), { competencyId: caseStudy, level: 4 }], programsMgr);
    const projectsMgr = await job('رئيس قسم المشاريع', projects, g4, 1, 'إدارة مشاريع الجمعية من الإعداد حتى الإغلاق', ['إعداد وثائق المشاريع', 'متابعة الصرف', 'تقارير المانحين'],
      [{ title: 'المشاريع المنفذة في موعدها', weight: 60, target: '90%' }, { title: 'الالتزام بالميزانية', weight: 40, target: '100%' }],
      [...core3(4), { competencyId: planning, level: 4 }], programsMgr);
    const fundraiser = await job('أخصائي تنمية موارد', resources, g3, 2, 'استقطاب التبرعات والمنح', ['متابعة المتبرعين', 'كتابة مقترحات المنح', 'تنظيم الحملات'],
      [{ title: 'التبرعات المحصّلة', weight: 60, target: '1,500,000', unit: 'ريال' }, { title: 'متبرعون جدد', weight: 40, target: '120', unit: 'متبرع' }],
      [...core3(3), { competencyId: fundraising, level: 4 }], ceo);
    const finMgr = await job('مدير الشؤون المالية والإدارية', finAdmin, g5, 1, 'إدارة الشؤون المالية والإدارية للجمعية', ['إعداد القوائم المالية', 'الرقابة على الصرف', 'إدارة الموارد البشرية'],
      [{ title: 'إقفال الشهر في موعده', weight: 50, target: '5', unit: 'أيام' }, { title: 'ملاحظات المراجع الخارجي', weight: 50, target: '0', unit: 'ملاحظة جوهرية' }],
      [...core3(4), { competencyId: planning, level: 4 }, { competencyId: decision, level: 4 }], ceo);
    const accountant = await job('محاسب', finAdmin, g2, 2, 'تسجيل العمليات المالية بدقة', ['إعداد السندات والقيود', 'المطابقات البنكية'],
      [{ title: 'دقة القيود', weight: 60, target: '99%' }, { title: 'المطابقة البنكية الشهرية', weight: 40, target: '100%' }], core3(3), finMgr);
    const hrOfficer = await job('أخصائي موارد بشرية', hrDept, g2, 1, 'إدارة شؤون الموظفين وفق اللائحة', ['ملفات الموظفين والعقود', 'الإجازات والرواتب', 'التوظيف'],
      [{ title: 'توثيق العقود في قوى', weight: 50, target: '100%' }, { title: 'شغل الشواغر في موعدها', weight: 50, target: '90%' }], core3(3), finMgr);
    const qualityOfficer = await job('أخصائي جودة', quality, g2, 1, 'متابعة نظام إدارة الجودة ISO 9001', ['مراجعة النماذج', 'التدقيق الداخلي'],
      [{ title: 'تنفيذ خطة التدقيق الداخلي', weight: 60, target: '100%' }, { title: 'إغلاق حالات عدم المطابقة', weight: 40, target: '30', unit: 'يومًا' }], core3(3), ceo);
    await job('منسق متطوعين', programs, g1, 1, 'تنسيق المتطوعين وفرص التطوع', ['استقطاب المتطوعين', 'متابعة الساعات'], [], core3(2), programsMgr, false);

    // ---- الموظفون (فريق الجمعية التجريبية نفسه)
    const salary = (basic: number) => [
      { code: 'housing', name: 'بدل السكن', amount: Math.round(basic * 0.25) }, { code: 'transport', name: 'بدل النقل', amount: Math.round(basic * 0.1) },
    ];
    let n = 0;
    const emp = async (fullName: string, jobId: string, basic: number, hiredDaysAgo: number, extra: Record<string, unknown> = {}) => {
      n++;
      const saudi = extra.isSaudi !== false;
      return (await this.people.create(admin, {
        fullName, nationalId: `${saudi ? 1 : 2}0${String(40000000 + n * 1371).padStart(8, '0')}`, nationality: saudi ? 'سعودي' : 'مصري', isSaudi: saudi,
        gender: 'male', jobId, hireDate: daysAgo(hiredDaysAgo), contractType: 'indefinite', contractStart: daysAgo(hiredDaysAgo), contractEnd: null,
        qiwaStatus: 'documented', basicSalary: basic, allowances: salary(basic), gosiNumber: `4${String(1000000 + n * 77)}`,
        gosiFirstRegistration: daysAgo(hiredDaysAgo + 400), iban: `SA03800000006080101675${String(n).padStart(2, '0')}`, probationEnd: null,
        idExpiry: daysAhead(900), ...extra,
      } as never)).id;
    };
    const ceoE = await emp(admin.fullName, ceo, 25000, 2900, { gender: 'male' });
    const programsE = await emp(team.caseManager.fullName, programsMgr, 16000, 1800, { managerId: ceoE });
    const researcherE = await emp(team.researcher.fullName, researcher, 7200, 700, { gender: 'female', managerId: programsE });
    await emp('هند سعد الدوسري', researcher, 6800, 75, {
      gender: 'female', managerId: programsE, contractType: 'fixed', contractEnd: daysAhead(290), probationEnd: daysAhead(15), gosiFirstRegistration: daysAgo(75), qiwaStatus: 'pending',
    });
    const projectsE = await emp(team.projectsManager.fullName, projectsMgr, 12500, 1200, { managerId: programsE });
    const fundraiserE = await emp(team.fundraiser.fullName, fundraiser, 9800, 1500, { managerId: ceoE, contractType: 'fixed', contractEnd: daysAhead(40) });
    const financeE = await emp(team.finance.fullName, finMgr, 17000, 2200, { managerId: ceoE });
    await emp('أحمد محمود عبدالرحمن', accountant, 7000, 1000, { isSaudi: false, managerId: financeE, idExpiry: daysAhead(55), passportExpiry: daysAhead(400), gosiNumber: null });
    const hrE = await emp('ريم خالد الشهري', hrOfficer, 7500, 500, { gender: 'female', managerId: financeE });
    const qualityE = await emp(team.quality.fullName, qualityOfficer, 7800, 900, { managerId: ceoE });

    // مديرو الوحدات
    const setManager = async (id: string, name: string, level: number, parentId: string | null, managerEmployeeId: string, costCenter: string) =>
      this.org.updateUnit(admin, id, { name, level, parentId, managerEmployeeId, costCenter });
    await setManager(exec, 'الإدارة التنفيذية', 0, null, ceoE, 'الإدارية والعمومية');
    await setManager(programs, 'إدارة البرامج والخدمات', 1, exec, programsE, 'البرامج');
    await setManager(projects, 'قسم المشاريع', 2, programs, projectsE, 'البرامج');
    await setManager(resources, 'إدارة تنمية الموارد', 1, exec, fundraiserE, 'جمع الأموال');
    await setManager(finAdmin, 'إدارة الشؤون المالية والإدارية', 1, exec, financeE, 'الإدارية والعمومية');
    await setManager(hrDept, 'قسم الموارد البشرية', 2, finAdmin, hrE, 'الإدارية والعمومية');
    await setManager(quality, 'قسم الجودة', 2, exec, qualityE, 'الإدارية والعمومية');
    void social;

    // ---- خطة التعيين
    const p1 = await this.org.createPlan(admin, { year, jobId: researcher, count: 2, plannedMonth: 3, fundingSource: 'grant', fundingNote: 'منحة دعم البرامج الاجتماعية', forSaudi: true, justification: 'زيادة الطلبات على البرامج الاجتماعية' });
    await this.org.submitPlan(admin, p1.id);
    await this.org.decidePlan(admin, p1.id, { decision: 'approve', note: 'معتمدة ضمن ميزانية المنحة' });
    const p2 = await this.org.createPlan(admin, { year, jobId: fundraiser, count: 1, plannedMonth: 9, fundingSource: 'own', forSaudi: true, justification: 'التوسع في حملات التبرع' });
    await this.org.submitPlan(admin, p2.id);
    await this.org.createPlan(admin, { year, jobId: accountant, count: 1, plannedMonth: 11, fundingSource: 'own', forSaudi: true, justification: 'فصل مهام المحاسبة عن الصرف' });

    // ---- الإجازات
    const leave = async (employeeId: string, leaveType: string, from: number, to: number, decide?: 'approve' | 'reject', note?: string) => {
      const l = await this.people.requestLeave(admin, { employeeId, leaveType, startDate: daysAgo(from), endDate: daysAgo(to), note: note ?? null });
      if (decide) await this.people.decideLeave(admin, l.id, decide, decide === 'reject' ? 'تزامن مع موسم رمضان' : null);
    };
    await leave(researcherE, 'annual', 120, 111, 'approve');
    await leave(projectsE, 'sick', 40, 38, 'approve', 'تقرير طبي مرفق');
    await leave(fundraiserE, 'annual', -20, -26, undefined, 'إجازة عائلية');
    await leave(financeE, 'annual', -45, -54);
    await leave(qualityE, 'annual', -5, -6, 'reject');

    // ---- بطاقات الأداء: بطاقة معتمدة وأخرى بانتظار الاعتماد والباقي في الإعداد
    await this.perf.generate(admin, year);
    const cards = (await this.perf.list(admin, year)).cards;
    const evaluate = async (employeeId: string, achievements: number[], rating: (required: number) => number, approve: boolean) => {
      const card = cards.find((c) => c.employeeId === employeeId);
      if (!card) return;
      await this.perf.action(admin, card.id, { action: 'agree' });
      const c = await this.perf.get(admin, card.id);
      await this.perf.update(admin, card.id, {
        objectives: c.objectives.map((o, i) => ({ ...o, achievement: achievements[i] ?? 100 })),
        competencies: c.competencies.map((x) => ({ competencyId: x.competencyId, requiredLevel: x.requiredLevel, rating: rating(x.requiredLevel) })),
        managerNote: 'أداء متميز والتزام عالٍ',
      });
      await this.perf.action(admin, card.id, { action: 'evaluate' });
      if (approve) await this.perf.action(admin, card.id, { action: 'approve' });
    };
    await evaluate(researcherE, [110, 95, 100], (r) => r, true);
    await evaluate(qualityE, [90, 80], (r) => Math.max(r - 1, 1), false);
    const agreed = cards.find((c) => c.employeeId === projectsE);
    if (agreed) await this.perf.action(admin, agreed.id, { action: 'agree' });
  }
}
