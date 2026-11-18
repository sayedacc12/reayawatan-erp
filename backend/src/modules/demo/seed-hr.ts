import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountsService } from '../accounting/accounts.service';
import { AttendanceService } from '../hr/attendance.service';
import { DevelopmentService } from '../hr/development.service';
import { HrCore, today } from '../hr/hr-core.service';
import { defaultPolicy } from '../hr/hr-policy';
import { OrgService } from '../hr/org.service';
import { PayrollService } from '../hr/payroll.service';
import { lastDay } from '../hr/people.service';
import { PeopleService } from '../hr/people.service';
import { PerformanceService } from '../hr/performance.service';
import { RequestsService } from '../hr/requests.service';
import { HrEmployee } from '../hr/entities/hr.entity';
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
    private readonly attendance: AttendanceService,
    private readonly payroll: PayrollService,
    private readonly dev: DevelopmentService,
    private readonly accounts: AccountsService,
    private readonly db: DataSource,
    private readonly requests: RequestsService,
  ) {}

  async run(team: DemoTeam) {
    const { admin } = team;
    const year = Number(today().slice(0, 4));
    // قوائم النظام المالي (أُنشئت في مرحلة النظام المالي قبل الموارد البشرية)
    const fin = await this.payroll.lookups(admin.organizationId);
    const accId = (code: string) => (fin.accounts as { id: string; code: string }[]).find((a) => a.code === code)!.id;
    const ccId = (code: string) => (fin.analytics as { id: string; code: string }[]).find((a) => a.code === code)!.id;
    const bankId = (name: string) => (fin.cashAccounts as { id: string; name: string }[]).find((c) => c.name.startsWith(name))!.id;
    await this.core.savePolicy(admin, { policy: defaultPolicy() as unknown as Record<string, unknown>, effectiveDate: `${year}-01-01`, note: 'اعتماد مجلس الإدارة للائحة الموارد البشرية' });
    await this.core.saveSettings(admin, { structureLevels: ['المدير التنفيذي', 'إدارة', 'قسم'] });

    // ---- الهيكل: قسم الجودة يتبع المدير التنفيذي مباشرة (تسلسل مرن)
    // كل وحدة إدارية مربوطة بحسابها التحليلي (مركز التكلفة)، والأقسام تأخذ حساب إدارتها إن لم يُحدد لها
    const cc: Record<string, string> = { 'الإدارية والعمومية': ccId('CC01'), البرامج: ccId('CC02'), 'جمع الأموال': ccId('CC04'), الحوكمة: ccId('CC05') };
    const unit = async (name: string, level: number, parentId: string | null, costCenter?: string, analytic = true) =>
      (await this.org.createUnit(admin, { name, level, parentId, costCenter: costCenter ?? null, analyticAccountId: analytic && costCenter ? cc[costCenter] : null })).id;
    const exec = await unit('الإدارة التنفيذية', 0, null, 'الإدارية والعمومية');
    const programs = await unit('إدارة البرامج والخدمات', 1, exec, 'البرامج');
    const social = await unit('قسم البحث الاجتماعي', 2, programs, 'البرامج', false);
    const projects = await unit('قسم المشاريع', 2, programs, 'البرامج', false);
    const resources = await unit('إدارة تنمية الموارد', 1, exec, 'جمع الأموال');
    const finAdmin = await unit('إدارة الشؤون المالية والإدارية', 1, exec, 'الإدارية والعمومية');
    const hrDept = await unit('قسم الموارد البشرية', 2, finAdmin, 'الإدارية والعمومية', false);
    const quality = await unit('قسم الجودة', 2, exec, 'الحوكمة');

    // ---- بنود الراتب: لكل بند حساب استحقاق وبنك صرف مستقل
    const types = await this.payroll.listAllowances(admin);
    const item = async (code: string, name: string, payable: string, bank: string, defaultKind: 'percent' | 'fixed', defaultValue: number) => {
      const t = types.find((x) => x.code === code);
      const dto = { code, name, defaultKind, defaultValue, payableAccountId: accId(payable), cashAccountId: bankId(bank) };
      if (t) await this.payroll.saveAllowance(admin, dto, t.id);
      else await this.payroll.saveAllowance(admin, dto);
    };
    await item('basic', 'الراتب الأساسي', '2140100101', 'مصرف الراجحي', 'fixed', 0);
    await item('housing', 'بدل السكن', '2140100102', 'مصرف الراجحي', 'percent', 25);
    await item('transport', 'بدل النقل', '2140100103', 'بنك الرياض', 'percent', 10);
    await item('phone', 'بدل الاتصال', '2140100104', 'بنك الرياض', 'fixed', 300);
    // ---- فئات تحميل المصروف: حسابات مصروف الرواتب حسب طبيعة الوظيفة (إدارية، برامج وأنشطة، جمع أموال)
    const programAcc = await this.programSalaryAccounts(admin);
    const profiles = await this.payroll.listProfiles(admin);
    const profileAccounts = (m: Record<string, string>) => Object.entries(m).map(([code, accountId]) => ({ code, accountId }));
    await this.payroll.saveProfile(admin, {
      name: 'المصروفات الإدارية', description: 'الإدارة التنفيذية والشؤون المالية والإدارية والجودة', isDefault: true,
      accounts: profileAccounts({ basic: accId('4110100101'), housing: accId('4110100201'), transport: accId('4110100301'), phone: accId('4110100401'), gosi: accId('4110100801') }),
    }, profiles.find((x) => x.isDefault)!.id);
    const programProfile = (await this.payroll.saveProfile(admin, {
      name: 'البرامج والأنشطة', description: 'الموظفون العاملون مباشرة على البرامج والمشاريع وخدمة المستفيدين',
      accounts: profileAccounts(programAcc),
    })).find((x) => x.name === 'البرامج والأنشطة')!.id;
    const frAcc = accId('4410100101');
    const fundraisingProfile = (await this.payroll.saveProfile(admin, {
      name: 'جمع الأموال', description: 'موظفو تنمية الموارد',
      accounts: profileAccounts({ basic: frAcc, housing: frAcc, transport: frAcc, phone: frAcc, gosi: frAcc }),
    })).find((x) => x.name === 'جمع الأموال')!.id;
    await this.payroll.saveConfig(admin, {
      payableAccountId: accId('2140100101'), gosiPayableAccountId: accId('2140100108'),
      deductionsAccountId: accId('1140100401'), defaultCashAccountId: bankId('مصرف الراجحي'),
      stages: [{ name: 'مراجعة الشؤون المالية', roleId: team.roles.finance }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
    });

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
      kpis: { title: string; weight: number; target: string; unit?: string }[], competencies: { competencyId: string; level: number }[], reportsToJobId: string | null = null, approve = true,
      expenseProfileId: string | null = null) => {
      const id = (await this.org.createJob(admin, {
        title, unitId, gradeId, headcount, purpose, responsibilities, qualifications: 'بكالوريوس في التخصص المناسب', experienceYears: 2,
        competencies, kpis, reportsToJobId, expenseProfileId,
      })).id;
      if (approve) await this.org.approveJob(admin, id);
      return id;
    };
    const ceo = await job('المدير التنفيذي', exec, g6, 1, 'قيادة الجمعية وتحقيق أهدافها الاستراتيجية', ['تنفيذ قرارات مجلس الإدارة', 'الإشراف على الإدارات', 'تمثيل الجمعية أمام الجهات'],
      [{ title: 'تحقيق مستهدفات الخطة السنوية', weight: 50, target: '90%' }, { title: 'نمو الإيرادات', weight: 30, target: '15%' }, { title: 'رضا الموظفين', weight: 20, target: '80%' }],
      [...core3(5), { competencyId: planning, level: 5 }, { competencyId: decision, level: 5 }]);
    const programsMgr = await job('مدير البرامج والخدمات', programs, g5, 1, 'إدارة برامج الجمعية وخدمات المستفيدين', ['اعتماد الحالات', 'متابعة جودة الخدمات', 'إعداد تقارير الأثر'],
      [{ title: 'متوسط مدة إنجاز الطلب', weight: 40, target: '10', unit: 'أيام' }, { title: 'نسبة رضا المستفيدين', weight: 30, target: '85%' }, { title: 'تنفيذ البرامج في موعدها', weight: 30, target: '95%' }],
      [...core3(4), { competencyId: planning, level: 4 }, { competencyId: decision, level: 4 }], ceo, true, programProfile);
    const researcher = await job('أخصائي اجتماعي', social, g2, 4, 'دراسة حالات المستفيدين وتقدير احتياجهم بعدالة', ['إجراء الزيارات الميدانية', 'إعداد البحث الاجتماعي', 'متابعة الحالات بعد الدعم'],
      [{ title: 'عدد الحالات المدروسة', weight: 50, target: '40', unit: 'حالة' }, { title: 'دقة البحث (حالات غير مُرجعة)', weight: 30, target: '90%' }, { title: 'الالتزام بمدة الدراسة', weight: 20, target: '7', unit: 'أيام' }],
      [...core3(3), { competencyId: caseStudy, level: 4 }], programsMgr, true, programProfile);
    const projectsMgr = await job('رئيس قسم المشاريع', projects, g4, 1, 'إدارة مشاريع الجمعية من الإعداد حتى الإغلاق', ['إعداد وثائق المشاريع', 'متابعة الصرف', 'تقارير المانحين'],
      [{ title: 'المشاريع المنفذة في موعدها', weight: 60, target: '90%' }, { title: 'الالتزام بالميزانية', weight: 40, target: '100%' }],
      [...core3(4), { competencyId: planning, level: 4 }], programsMgr, true, programProfile);
    const fundraiser = await job('أخصائي تنمية موارد', resources, g3, 2, 'استقطاب التبرعات والمنح', ['متابعة المتبرعين', 'كتابة مقترحات المنح', 'تنظيم الحملات'],
      [{ title: 'التبرعات المحصّلة', weight: 60, target: '1,500,000', unit: 'ريال' }, { title: 'متبرعون جدد', weight: 40, target: '120', unit: 'متبرع' }],
      [...core3(3), { competencyId: fundraising, level: 4 }], ceo, true, fundraisingProfile);
    const finMgr = await job('مدير الشؤون المالية والإدارية', finAdmin, g5, 1, 'إدارة الشؤون المالية والإدارية للجمعية', ['إعداد القوائم المالية', 'الرقابة على الصرف', 'إدارة الموارد البشرية'],
      [{ title: 'إقفال الشهر في موعده', weight: 50, target: '5', unit: 'أيام' }, { title: 'ملاحظات المراجع الخارجي', weight: 50, target: '0', unit: 'ملاحظة جوهرية' }],
      [...core3(4), { competencyId: planning, level: 4 }, { competencyId: decision, level: 4 }], ceo);
    const accountant = await job('محاسب', finAdmin, g2, 2, 'تسجيل العمليات المالية بدقة', ['إعداد السندات والقيود', 'المطابقات البنكية'],
      [{ title: 'دقة القيود', weight: 60, target: '99%' }, { title: 'المطابقة البنكية الشهرية', weight: 40, target: '100%' }], core3(3), finMgr);
    const hrOfficer = await job('أخصائي موارد بشرية', hrDept, g2, 1, 'إدارة شؤون الموظفين وفق اللائحة', ['ملفات الموظفين والعقود', 'الإجازات والرواتب', 'التوظيف'],
      [{ title: 'توثيق العقود في قوى', weight: 50, target: '100%' }, { title: 'شغل الشواغر في موعدها', weight: 50, target: '90%' }], core3(3), finMgr);
    const qualityOfficer = await job('أخصائي جودة', quality, g2, 1, 'متابعة نظام إدارة الجودة ISO 9001', ['مراجعة النماذج', 'التدقيق الداخلي'],
      [{ title: 'تنفيذ خطة التدقيق الداخلي', weight: 60, target: '100%' }, { title: 'إغلاق حالات عدم المطابقة', weight: 40, target: '30', unit: 'يومًا' }], core3(3), ceo);
    await job('منسق متطوعين', programs, g1, 1, 'تنسيق المتطوعين وفرص التطوع', ['استقطاب المتطوعين', 'متابعة الساعات'], [], core3(2), programsMgr, false, programProfile);

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
    const ceoE = await emp(admin.fullName, ceo, 25000, 2900, { gender: 'male', attendanceExempt: true, allowances: [...salary(25000), { code: 'phone', name: 'بدل الاتصال', amount: 500 }] });
    const programsE = await emp(team.caseManager.fullName, programsMgr, 16000, 1800, { managerId: ceoE });
    const researcherE = await emp(team.researcher.fullName, researcher, 7200, 700, { gender: 'female', managerId: programsE });
    const hindE = await emp('هند سعد الدوسري', researcher, 6800, 75, {
      gender: 'female', managerId: programsE, contractType: 'fixed', contractEnd: daysAhead(290), probationEnd: daysAhead(15), gosiFirstRegistration: daysAgo(75), qiwaStatus: 'pending',
    });
    const projectsE = await emp(team.projectsManager.fullName, projectsMgr, 12500, 1200, { managerId: programsE });
    const fundraiserE = await emp(team.fundraiser.fullName, fundraiser, 9800, 1500, { managerId: ceoE, contractType: 'fixed', contractEnd: daysAhead(40) });
    const financeE = await emp(team.finance.fullName, finMgr, 17000, 2200, { managerId: ceoE, allowances: [...salary(17000), { code: 'phone', name: 'بدل الاتصال', amount: 300 }] });
    const accountantE = await emp('أحمد محمود عبدالرحمن', accountant, 7000, 1000, { isSaudi: false, managerId: financeE, idExpiry: daysAhead(55), passportExpiry: daysAhead(400), gosiNumber: null });
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
    await evaluate(fundraiserE, [85, 70], (r) => (r >= 4 ? r - 2 : r - 1), true);
    await evaluate(hrE, [100, 95], (r) => r, true);
    const agreed = cards.find((c) => c.employeeId === projectsE);
    if (agreed) await this.perf.action(admin, agreed.id, { action: 'agree' });

    await this.seedDevelopment(team, year, {
      jobs: { ceo, programsMgr, projectsMgr, finMgr, accountant, researcher },
      emps: { programsE, projectsE, researcherE, financeE, accountantE, fundraiserE, qualityE, hrE, hindE },
    });

    await this.seedSelfService(team, { ceoE, programsE, researcherE, projectsE, fundraiserE, financeE, qualityE });

    await this.seedAttendanceAndPayroll(team, year);
  }

  /**
   * الخدمة الذاتية: ربط حسابات فريق الجمعية التجريبية بملفاتهم، أنواع الطلبات الافتراضية،
   * وطلبات في مراحل مختلفة: إجازة بانتظار المدير المباشر، خطاب تعريف بالراتب معتمد، استئذان معتمد،
   * سلفة معتمدة تُسترد من مسير الرواتب، إجازة مرضية بمرفق، طلب معاد للتعديل، وإجازة معتمدة بمسارها كاملًا.
   */
  private async seedSelfService(team: DemoTeam, e: Record<'ceoE' | 'programsE' | 'researcherE' | 'projectsE' | 'fundraiserE' | 'financeE' | 'qualityE', string>) {
    const { admin } = team;
    const org = admin.organizationId;
    const repo = this.db.getRepository(HrEmployee);
    const links: [{ id: string }, string][] = [
      [admin, e.ceoE], [team.caseManager, e.programsE], [team.researcher, e.researcherE], [team.projectsManager, e.projectsE],
      [team.fundraiser, e.fundraiserE], [team.finance, e.financeE], [team.quality, e.qualityE],
    ];
    for (const [u, emp] of links) await repo.update({ id: emp }, { userId: u.id });
    await this.requests.addDefaults(org);
    const types = await this.requests.types(org);
    const T = (code: string) => types.find((t) => t.code === code)!.id;
    const pdf = (name: string) => ({
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'), size: 64, originalname: Buffer.from(name, 'utf8').toString('latin1'),
    } as Express.Multer.File);

    // إجازة سنوية للباحثة بانتظار مديرها المباشر (مدير البرامج)
    await this.requests.submit(team.researcher, { typeId: T('leave'), data: { leaveType: 'annual', startDate: daysAhead(12), endDate: daysAhead(16), note: 'إجازة عائلية' } }, []);
    // خطاب تعريف بالراتب موجه لبنك: اعتمدته شؤون الموظفين وجاهز للطباعة
    const letter = await this.requests.submit(team.researcher, { typeId: T('salary_certificate'), data: { templateId: 'bank', addressee: 'مصرف الراجحي - فرع العليا' } }, []);
    await this.requests.decide(team.finance, letter.id, 'approve', 'صدر الخطاب');
    // استئذان خروج مبكر لمدير المشاريع اعتمده مديره
    const perm = await this.requests.submit(team.projectsManager, { typeId: T('permission'), data: { permissionKind: 'early', date: daysAhead(1), fromTime: '13:00', toTime: '15:00', note: 'مراجعة مستشفى' } }, []);
    await this.requests.decide(team.caseManager, perm.id, 'approve', null);
    // إجازة مرضية لمدير المشاريع بعد وقوعها بتقرير طبي، بانتظار مديره
    await this.requests.submit(team.projectsManager, { typeId: T('sick_leave'), data: { leaveType: 'sick', startDate: daysAgo(2), endDate: daysAgo(1), note: 'نزلة برد' } }, [pdf('تقرير طبي.pdf')]);
    // سلفة لمسؤول تنمية الموارد: المدير المباشر (المدير التنفيذي) ثم شؤون الموظفين، وتُسترد من مسير الرواتب
    const adv = await this.requests.submit(team.fundraiser, { typeId: T('advance'), data: { amount: 6000, installments: 6, reason: 'ظروف عائلية طارئة' } }, []);
    await this.requests.decide(admin, adv.id, 'approve', 'موافق');
    await this.requests.decide(team.finance, adv.id, 'approve', 'تُخصم من الراتب ستة أشهر');
    // تبدأ أقساطها من الشهر السابق حتى يظهر القسط الأول في كشفه المعتمد
    const prev = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    await this.db.query(`UPDATE hr_advances SET start_month = $1 WHERE request_id = $2`, [prev.toISOString().slice(0, 7), adv.id]);
    // طلب عام لمسؤول الجودة أعاده المدير التنفيذي للتعديل
    const gen = await this.requests.submit(team.quality, { typeId: T('general'), fields: { subject: 'تحديث الحساب البنكي', details: 'أرجو تحديث رقم الآيبان لتحويل الراتب إلى حسابي الجديد' } }, []);
    await this.requests.decide(admin, gen.id, 'return', 'أرفق خطاب البنك بالآيبان الجديد');
    // إجازة سنوية للمدير المالي اعتمدها المدير التنفيذي ثم شؤون الموظفين
    const fl = await this.requests.submit(team.finance, { typeId: T('leave'), data: { leaveType: 'annual', startDate: daysAhead(70), endDate: daysAhead(74), note: null } }, []);
    await this.requests.decide(admin, fl.id, 'approve', null);
    await this.requests.decide(admin, fl.id, 'approve', 'تُغطى المهام بالمحاسب');
    // استئذان لمدير البرامج بانتظار المدير التنفيذي
    await this.requests.submit(team.caseManager, { typeId: T('permission'), data: { permissionKind: 'official', date: daysAhead(3), fromTime: '09:00', toTime: '12:00', note: 'اجتماع في وزارة الموارد البشرية' } }, []);
  }

  /** الحضور: إعدادات الدوام وجهاز بصمة وملف حضور للشهر السابق والحالي، ثم كشف الشهر السابق معتمدًا بقيده وسنداته وكشف الشهر الحالي قيد الإعداد */
  private async seedAttendanceAndPayroll(team: DemoTeam, year: number) {
    const { admin } = team;
    const org = admin.organizationId;
    await this.attendance.saveConfig(admin, {
      enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6],
      holidays: [{ date: `${year}-02-22`, name: 'يوم التأسيس' }, { date: `${year}-09-23`, name: 'اليوم الوطني' }],
    });
    await this.attendance.saveDevice(admin, { name: 'جهاز البصمة - المقر الرئيسي', brand: 'ZKTeco', serialNumber: `DEMO${org.replace(/-/g, '').slice(0, 10)}`, location: 'مدخل الموظفين' });

    const t = today();
    const cur = t.slice(0, 7);
    const d = new Date(`${cur}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const prev = d.toISOString().slice(0, 7);
    const employees = (await this.people.list(admin)).filter((e) => e.status === 'active');
    // ملف حضور بصيغة أجهزة البصمة (رقم الموظف، التاريخ والوقت) من بداية الشهر السابق حتى أمس
    const lines: string[] = ['No.,Name,Date/Time'];
    const pad = (n: number) => String(n).padStart(2, '0');
    for (let day = new Date(`${prev}-01T00:00:00Z`); day.toISOString().slice(0, 10) < t; day.setUTCDate(day.getUTCDate() + 1)) {
      const ds = day.toISOString().slice(0, 10);
      if ([5, 6].includes(day.getUTCDay())) continue;
      const dn = day.getUTCDate();
      employees.forEach((e, i) => {
        if (e.employeeNo === 1) return; // المدير التنفيذي معفى من البصمة
        if (e.hireDate > ds) return;
        // غياب يومين لموظف واحد في الشهر السابق، وتأخير متكرر لآخر
        if (e.employeeNo === 8 && ds.startsWith(prev) && (dn === 8 || dn === 21)) return;
        const late = e.employeeNo === 5 && dn % 6 === 0;
        const inMin = late ? 8 * 60 + 35 : 7 * 60 + 40 + ((dn * 7 + i * 3) % 25);
        const outMin = 15 * 60 + ((dn * 5 + i) % 20);
        lines.push(`${e.employeeNo},${e.fullName},${ds} ${pad(Math.floor(inMin / 60))}:${pad(inMin % 60)}`);
        if (!(e.employeeNo === 3 && dn === 12)) lines.push(`${e.employeeNo},${e.fullName},${ds} ${pad(Math.floor(outMin / 60))}:${pad(outMin % 60)}`);
      });
    }
    await this.attendance.importFile(admin, { originalname: Buffer.from(`حضور-${prev}.csv`).toString('latin1'), buffer: Buffer.from(lines.join('\n')) });

    // كشف الشهر السابق: إعداد ثم اعتماد بمرحلتين (يصدر القيد) ثم سندات الصرف
    if (prev.slice(0, 4) === String(year)) {
      const run = await this.payroll.create(admin, prev);
      const hind = run.lines.find((l) => l.employeeNo === 4);
      if (hind) {
        await this.payroll.updateLine(admin, run.id, hind.employeeId, {
          additions: [{ code: 'transport', amount: 250, note: 'فرق بدل نقل عن الشهر الأول' }], otherDeduction: 0, otherDeductionNote: null,
        });
      }
      const acc = run.lines.find((l) => l.employeeNo === 8);
      if (acc) await this.payroll.updateLine(admin, run.id, acc.employeeId, { additions: [], otherDeduction: 500, otherDeductionNote: 'قسط سلفة شخصية (3 من 6)' });
      await this.payroll.submit(admin, run.id);
      await this.payroll.decide(admin, run.id, { decision: 'approve', note: 'روجعت البصمات والاستقطاعات' });
      await this.payroll.decide(admin, run.id, { decision: 'approve', note: 'معتمد' });
      await this.payroll.createVouchers(admin, run.id, { voucherDate: lastDay(prev) < t ? lastDay(prev) : t });
    }
    // كشف الشهر الحالي قيد الإعداد
    await this.payroll.create(admin, cur);
  }

  /** حسابات مصروف رواتب العاملين على البرامج والأنشطة (لا يتضمنها الدليل الموحد، فتُفتح تحت مصاريف البرامج) */
  private async programSalaryAccounts(admin: DemoTeam['admin']) {
    const org = admin.organizationId;
    const [parent] = await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND code = '422'`, [org]);
    const main = await this.accounts.create(admin, { code: '42204', name: 'رواتب ومزايا العاملين على البرامج والأنشطة', kind: 'main', nature: 'expenses', parentId: parent.id });
    const group = await this.accounts.create(admin, { code: '42204001', name: 'الرواتب والأجور النقدية ــ البرامج والأنشطة', kind: 'main', nature: 'expenses', parentId: main.id });
    const sub = async (code: string, name: string) => (await this.accounts.create(admin, { code, name, kind: 'sub', nature: 'expenses', parentId: group.id })).id;
    return {
      basic: await sub('4220400101', 'الرواتب الأساسية ــ البرامج والأنشطة'), housing: await sub('4220400102', 'بدل السكن ــ البرامج والأنشطة'),
      transport: await sub('4220400103', 'بدل المواصلات ــ البرامج والأنشطة'), phone: await sub('4220400104', 'بدل اتصال ــ البرامج والأنشطة'),
      gosi: await sub('4220400108', 'تأمينات اجتماعية ــ البرامج والأنشطة'),
    };
  }

  /**
   * التطوير والتدريب والصف الثاني: مراحل الاعتماد، خطط تطوير بمراحل مختلفة (من فجوة الجدارات في تقييمات الأداء)،
   * وظائف بديلة ومرشحون للصف الثاني، مع وظائف بلا بديل تظهر بعلامة حمراء.
   */
  private async seedDevelopment(team: DemoTeam, year: number, x: {
    jobs: Record<'ceo' | 'programsMgr' | 'projectsMgr' | 'finMgr' | 'accountant' | 'researcher', string>;
    emps: Record<'programsE' | 'projectsE' | 'researcherE' | 'financeE' | 'accountantE' | 'fundraiserE' | 'qualityE' | 'hrE' | 'hindE', string>;
  }) {
    const { admin } = team;
    const cfg = (await this.dev.getConfig(admin)).config;
    await this.dev.saveConfig(admin, {
      stages: [{ name: 'مراجعة الموارد البشرية', roleId: team.roles.finance }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
      activityTypes: cfg.activityTypes,
    });
    const items = (p: Awaited<ReturnType<DevelopmentService['get']>>, f: (i: (typeof p.items)[number], k: number) => Partial<(typeof p.items)[number]>) =>
      p.items.map((i, k) => {
        const v = { ...i, ...f(i, k) };
        return {
          id: v.id, competencyId: v.competencyId, name: v.name, requiredLevel: v.requiredLevel, currentLevel: v.currentLevel, targetLevel: v.targetLevel,
          activityType: v.activityType, activity: v.activity, provider: v.provider, dueDate: v.dueDate, cost: v.cost, hours: v.hours, note: v.note,
        };
      });
    const approve = async (id: string) => {
      await this.dev.submit(admin, id);
      await this.dev.decide(admin, id, { decision: 'approve', note: 'تتوافق مع احتياج القسم' });
      await this.dev.decide(admin, id, { decision: 'approve', note: 'معتمدة' });
    };

    // 1) أخصائي الجودة: خطة معتمدة وقيد التنفيذ (نشاط منجز وآخر جارٍ)
    let p = await this.dev.create(admin, { employeeId: x.emps.qualityE, kind: 'individual', year });
    const quality = [
      { activityType: 'course', activity: 'دورة مهارات التواصل والعرض الفعّال', provider: 'معهد الإدارة العامة', cost: 1800, hours: 24, dueDate: `${year}-04-30` },
      { activityType: 'workshop', activity: 'ورشة بناء فرق العمل', provider: 'مركز التدريب الأهلي', cost: 900, hours: 12, dueDate: `${year}-06-30` },
      { activityType: 'mentoring', activity: 'إرشاد شهري مع المدير التنفيذي في قيم النزاهة والامتثال', provider: null, cost: 0, hours: 10, dueDate: `${year}-12-31` },
    ];
    p = await this.dev.update(admin, p.id, {
      title: p.title, goals: ['رفع جدارات التواصل والعمل الجماعي للمستوى المطلوب', 'تحسين نتيجة الجدارات في تقييم العام القادم إلى 90%'],
      items: items(p, (_, k) => quality[k % quality.length]),
    });
    await approve(p.id);
    p = await this.dev.get(admin, p.id);
    await this.dev.progress(admin, p.id, {
      items: p.items.map((i, k) => ({ id: i.id, status: k === 0 ? 'done' : k === 1 ? 'in_progress' : 'planned', achievedLevel: k === 0 ? i.targetLevel : null, note: k === 0 ? 'اجتاز الدورة بتقدير ممتاز' : null })),
    });

    // 2) أخصائي تنمية الموارد: خطة بانتظار المرحلة الأولى
    p = await this.dev.create(admin, { employeeId: x.emps.fundraiserE, kind: 'individual', year });
    p = await this.dev.update(admin, p.id, {
      title: p.title, goals: ['الفوز بمنحتين من جهات مانحة جديدة', 'سد فجوة جدارة تنمية الموارد المالية بمستويين'],
      items: items(p, (i) => i.name.includes('تنمية') ? { activityType: 'certificate', activity: 'شهادة أخصائي جمع تبرعات معتمد (CFRE)', provider: 'جهة دولية معتمدة', cost: 6500, hours: 60 }
        : { activityType: 'workshop', activity: `ورشة ${i.name}`, provider: 'مركز التدريب الأهلي', cost: 700, hours: 8 }),
    });
    await this.dev.submit(admin, p.id);

    // 3) الموظفة الجديدة: خطة قيد الإعداد (جداراتها لم تُقيَّم بعد)
    p = await this.dev.create(admin, { employeeId: x.emps.hindE, kind: 'individual', year });
    await this.dev.update(admin, p.id, {
      title: p.title, goals: ['اجتياز فترة التجربة بإتقان أدوات البحث الاجتماعي'],
      items: items(p, (i) => ({ currentLevel: i.requiredLevel ? Math.max(i.requiredLevel - 2, 1) : null, activityType: 'ojt', activity: `تدريب على رأس العمل في ${i.name} مع أخصائي أول`, hours: 20 })),
    });

    // 4) أخصائية الموارد البشرية: خطة العام الماضي مكتملة ومغلقة
    p = await this.dev.create(admin, { employeeId: x.emps.hrE, kind: 'individual', year: year - 1 });
    p = await this.dev.update(admin, p.id, {
      title: p.title, goals: ['إتقان نظام قوى والتأمينات الاجتماعية'],
      items: [{ competencyId: null, name: 'أنظمة العمل والتأمينات', requiredLevel: null, currentLevel: 2, targetLevel: 4, activityType: 'course', activity: 'دورة نظام العمل السعودي ولائحته التنفيذية', provider: 'الغرفة التجارية', dueDate: `${year - 1}-10-31`, cost: 1200, hours: 18, note: null }],
    });
    await approve(p.id);
    p = await this.dev.get(admin, p.id);
    await this.dev.progress(admin, p.id, { items: p.items.map((i) => ({ id: i.id, status: 'done', achievedLevel: 4, note: 'حصلت على الشهادة' })) });
    await this.dev.complete(admin, p.id, 'حققت الخطة مستهدفاتها');

    // ---- الصف الثاني: وظائف بديلة ومرشحون، والباقي بلا بديل (علامة حمراء)
    const j = x.jobs;
    await this.dev.setBackup(admin, j.ceo, { backupJobId: j.programsMgr });
    await this.dev.setBackup(admin, j.programsMgr, { backupJobId: j.projectsMgr });
    await this.dev.setBackup(admin, j.projectsMgr, { backupJobId: j.researcher });
    await this.dev.setBackup(admin, j.finMgr, { backupJobId: j.accountant });
    await this.dev.addCandidate(admin, j.ceo, { employeeId: x.emps.programsE, readiness: '1y', note: 'يحتاج خبرة في الشؤون المالية والعلاقات مع المانحين' });
    await this.dev.addCandidate(admin, j.ceo, { employeeId: x.emps.financeE, readiness: '2y', note: null });
    await this.dev.addCandidate(admin, j.programsMgr, { employeeId: x.emps.projectsE, readiness: 'now', note: 'أدار البرامج بالإنابة خلال الإجازات' });
    await this.dev.addCandidate(admin, j.projectsMgr, { employeeId: x.emps.researcherE, readiness: '1y', note: null });
    await this.dev.addCandidate(admin, j.finMgr, { employeeId: x.emps.accountantE, readiness: '2y', note: null });
    // خطة إعداد الباحثة الاجتماعية لرئاسة قسم المشاريع: معتمدة
    p = await this.dev.create(admin, { employeeId: x.emps.researcherE, kind: 'succession', targetJobId: j.projectsMgr, year });
    p = await this.dev.update(admin, p.id, {
      title: p.title, goals: [...p.goals, 'إدارة مشروع واحد كاملًا تحت إشراف رئيس القسم'],
      items: [
        ...items(p, (i) => ({ activityType: i.name.includes('التخطيط') ? 'course' : 'project', activity: i.name.includes('التخطيط') ? 'دورة إدارة المشاريع الاحترافية (PMP)' : `قيادة مهمة تطويرية في ${i.name}`, cost: i.name.includes('التخطيط') ? 4500 : 0, hours: i.name.includes('التخطيط') ? 35 : 15 })),
        { competencyId: null, name: 'إدارة ميزانيات المشاريع', requiredLevel: null, currentLevel: 1, targetLevel: 3, activityType: 'rotation', activity: 'تكليف مؤقت في قسم المشاريع لمدة شهرين', provider: null, dueDate: `${year}-12-31`, cost: 0, hours: 160, note: null },
      ],
    });
    await approve(p.id);
  }
}
