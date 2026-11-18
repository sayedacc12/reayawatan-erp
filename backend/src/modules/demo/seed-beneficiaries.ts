import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In } from 'typeorm';
import { Permission, Role, User } from '../../core/entities';
import { ACC_PERMISSIONS as A } from '../accounting/accounting.manifest';
import { BENEFICIARY_PERMISSIONS as P } from '../beneficiaries/beneficiaries.manifest';
import { normalizeFields, normalizeRules } from '../beneficiaries/dynamic-forms';
import { Activity, Beneficiary, BeneficiarySettings, DynamicForm, FamilyMember, Ticket, Workflow, WorkflowStage } from '../beneficiaries/entities';
import { RequestsService } from '../beneficiaries/requests.service';
import { FUNDRAISING_PERMISSIONS as F } from '../fundraising/fundraising.manifest';
import { PROJECT_PERMISSIONS as PR } from '../projects/projects.manifest';
import { QUALITY_PERMISSIONS as Q } from '../quality/quality.manifest';
import { PARTNERSHIP_PERMISSIONS as PT } from '../partnerships/partnerships.manifest';
import { ALL_PERMISSIONS, DEMO_EMAIL, DemoTeam, DemoTree, actorOf, daysAgo } from './demo-context';

/** نموذج تجريبي عدّى على مسار الاعتماد كله (إنشاء ← مراجعة الجودة ← اعتماد مدير الشاشة) */
function approvedDemo(qualityCode: string) {
  const at = new Date().toISOString();
  return {
    qualityCode, revision: 0, status: 'approved' as const, createdByName: 'خالد إبراهيم',
    reviewedByName: 'هبة سمير', reviewedAt: new Date(), approvedByName: 'خالد إبراهيم', approvedAt: new Date(),
    history: [
      { step: 'created' as const, by: 'خالد إبراهيم', at }, { step: 'submitted' as const, by: 'خالد إبراهيم', at },
      { step: 'reviewed' as const, by: 'هبة سمير', at }, { step: 'approved' as const, by: 'خالد إبراهيم', at, revision: 0 },
    ],
  };
}

/** طلبات المستفيدين التي تحتاجها مراحل الدعم والصرف */
export interface DemoCases {
  /** أرملة: معتمد نهائيًا، كفالة سنوية 12,000 ريال */
  widow: string;
  /** حقيبة مدرسية: معتمد نهائيًا، 1,500 ريال */
  school: string;
  /** يتيمة: في مرحلة البحث الاجتماعي */
  orphan: string;
  /** عملية جراحية: بانتظار إثبات مساهمة المستفيد 30% */
  surgery: string;
  portalUsers: { fullName: string; nationalId: string }[];
}

/**
 * الجزء الخاص بالمستفيدين: الموظفون بأدوارهم، النماذج المعتمدة، سير العمل، شجرة الأنشطة،
 * والمستفيدون وطلباتهم في مراحل مختلفة.
 */
@Injectable()
export class BeneficiariesSeed {
  constructor(
    private readonly db: DataSource,
    private readonly requests: RequestsService,
  ) {}

  async setup(em: EntityManager, orgId: string, password: string): Promise<{ team: DemoTeam; tree: DemoTree; accounts: { role: string; email: string }[] }> {
    const hash = await bcrypt.hash(password, 12);
    const perms = (codes: string[]) => em.find(Permission, { where: { code: In(codes) } });
    const role = async (name: string, description: string, codes: string[]) =>
      em.save(em.create(Role, { organizationId: orgId, name, description, permissions: await perms(codes) }));

    const roleCodes = {
      researcher: [P.read, P.requestsRead, P.requestsProcess, P.research],
      quality: [P.formsReview, Q.read, Q.context, Q.documents, Q.reviewDocs, Q.audits, Q.ncr, Q.closeNcr, Q.risks, Q.objectives, Q.reviews, Q.feedback, Q.reports],
      caseManager: [P.read, P.manage, P.requestsRead, P.requestsCreate, P.requestsProcess, P.aid, P.tickets, P.documents, P.formsApprove, P.reports, Q.read, Q.feedback],
      fundraiser: [F.donorsRead, F.donorsManage, F.read, F.create, F.collect, F.reports, PT.read, PT.partners, PT.evaluate, PT.contracts, PT.reports],
      finance: [F.donorsRead, F.read, F.process, F.collect, F.journal, F.reports, PR.read, PR.disburse, PR.reports,
        A.read, A.receipts, A.payments, A.approveVouchers, A.entries, A.post, A.cancel, A.partners, A.banks, A.reports,
        // شؤون الموظفين تتبع الإدارة المالية والإدارية: خطوة «شؤون الموظفين» في طلبات الخدمة الذاتية
        'hr.requests.read', 'hr.requests.approve', 'hr.separations.approve'],
      projectsManager: [PR.read, PR.manage, PR.approve, PR.support, PR.transfers, PR.amendments, PR.reports, PR.settings, F.read, F.donorsRead, P.read, P.requestsRead],
    };
    const researcherRole = await role('باحث اجتماعي', 'يجري البحث الميداني ويعبّئ نموذج البحث', roleCodes.researcher);
    const qualityRole = await role('مراجع الجودة', 'يدير نظام الجودة ISO 9001: الوثائق والمراجعات وعدم المطابقة والشكاوى، ويراجع نماذج المراحل وأكوادها', roleCodes.quality);
    const managerRole = await role('مدير الحالات', 'يراجع الطلبات ويعتمدها نهائيًا', roleCodes.caseManager);
    const fundraiserRole = await role('مسؤول تنمية الموارد', 'يسجل الداعمين وفرص التبرع ويتابع سداد الوعود، ويدير الشراكات وعقودها', roleCodes.fundraiser);
    const financeRole = await role('المدير المالي', 'يدقق فرص التبرع وينفذ طلبات الصرف ويتابع القيود', roleCodes.finance);
    const projectsRole = await role('مدير المشاريع', 'يدير المشاريع واعتمادها وتحميل الطلبات على دفعات الداعمين', roleCodes.projectsManager);

    const user = (fullName: string, email: string, extra: Partial<User>) => em.save(em.create(User, {
      organizationId: orgId, fullName, email, passwordHash: hash, ...extra,
    }));
    const admin = await user('مدير الجمعية التجريبية', DEMO_EMAIL('admin'), { isSuperadmin: true });
    const researcher = await user('منى عبد الرحمن', DEMO_EMAIL('researcher'), { roles: [researcherRole] });
    const caseManager = await user('خالد إبراهيم', DEMO_EMAIL('manager'), { roles: [managerRole] });
    const quality = await user('هبة سمير', DEMO_EMAIL('quality'), { roles: [qualityRole] });
    const fundraiser = await user('سارة القحطاني', DEMO_EMAIL('fundraising'), { roles: [fundraiserRole] });
    const finance = await user('عبدالله الشهري', DEMO_EMAIL('finance'), { roles: [financeRole] });
    const projectsManager = await user('ريم الدوسري', DEMO_EMAIL('projects'), { roles: [projectsRole] });

    const appForm = await em.save(em.create(DynamicForm, {
      organizationId: orgId, ...approvedDemo('QF-BEN-01'), name: 'نموذج بيانات الطلب', description: 'يعبّئه المستفيد عند التقديم',
      fields: normalizeFields([
        { key: 'reason', label: 'سبب الطلب', type: 'textarea', required: true, placeholder: 'اشرح ظروفك باختصار' },
        { key: 'members', label: 'عدد أفراد الأسرة', type: 'number', required: true },
        { key: 'amount', label: 'المبلغ المطلوب تقريبًا', type: 'number' },
        { key: 'has_income', label: 'يوجد دخل ثابت للأسرة', type: 'checkbox' },
      ]),
    }));
    const researchForm = await em.save(em.create(DynamicForm, {
      organizationId: orgId, ...approvedDemo('QF-BEN-02'), name: 'نموذج البحث الاجتماعي', description: 'يعبّئه الباحث بعد الزيارة الميدانية، ويحسب النظام نتيجة التقييم',
      scored: true,
      fields: normalizeFields([
        { key: 'visit_date', label: 'تاريخ الزيارة', type: 'date', required: true },
        { key: 'housing', label: 'حالة السكن', type: 'select', required: true, options: ['جيدة', 'متوسطة', 'سيئة'], weight: 30, optionScores: [0, 50, 100] },
        { key: 'rooms', label: 'عدد الغرف', type: 'number' },
        { key: 'no_income', label: 'لا يوجد دخل ثابت للأسرة', type: 'checkbox', weight: 20 },
        { key: 'income_verified', label: 'تم التحقق من الدخل', type: 'checkbox' },
        { key: 'need', label: 'درجة الاحتياج', type: 'select', required: true, options: ['عالية', 'متوسطة', 'منخفضة'], weight: 50, optionScores: [100, 60, 0] },
        { key: 'assessment', label: 'تقييم الباحث', type: 'support', required: true },
        { key: 'recommendation', label: 'توصية الباحث', type: 'textarea', required: true },
      ], true),
      rules: normalizeRules([
        { min: 0, max: 39.99, outcome: 'reject' },
        { min: 40, max: 69.99, outcome: 'contribution', contributionPercent: 30 },
        { min: 70, max: 100, outcome: 'approve' },
      ]),
    }));
    const workflow = await em.save(em.create(Workflow, {
      organizationId: orgId, name: 'سير عمل طلبات المساعدة', description: 'من استلام الطلب حتى الاعتماد النهائي',
      isDefault: true, applicationFormId: appForm.id,
    }));
    const stages = [
      { name: 'مراجعة الطلب', instructions: 'تأكد من اكتمال البيانات والمستندات', roleId: managerRole.id, canReject: true },
      { name: 'البحث الاجتماعي', instructions: 'زيارة ميدانية وتعبئة نموذج البحث', formId: researchForm.id, roleId: researcherRole.id },
      { name: 'لجنة الحالات', instructions: 'مناقشة الحالة وتحديد نوع المساعدة وتكلفتها' },
      { name: 'تأكيد مساهمة المستفيد', kind: 'contribution' as const, instructions: 'راجع إثبات المساهمة الذي رفعه المستفيد من البوابة', roleId: managerRole.id },
      { name: 'الاعتماد النهائي', instructions: 'اعتماد الطلب من مدير الحالات', roleId: managerRole.id },
    ];
    for (const [i, s] of stages.entries()) {
      await em.save(em.create(WorkflowStage, { organizationId: orgId, workflowId: workflow.id, sortOrder: i + 1, canReturn: true, canReject: true, ...s }));
    }

    // الشجرة: المشاريع تبدأ مسودة، ثم تمر على مراحل اعتماد المشاريع في نظام إدارة المشاريع
    let order = 0;
    const act = (level: Activity['level'], name: string, parentId: string | null, description?: string, rules: Partial<Activity> = {}) =>
      em.save(em.create(Activity, {
        organizationId: orgId, level, name, parentId, description: description ?? null, sortOrder: ++order,
        ...(level === 'project' ? { approvalStatus: 'draft' as const } : {}), ...rules,
      }));
    const zakat = { fundingType: 'restricted' as const, zakatEligible: true };
    const social = await act('axis', 'الرعاية الاجتماعية', null);
    const sponsorship = await act('program', 'كفالة الأسر', social.id);
    const orphans = await act('project', 'كفالة الأيتام', sponsorship.id, 'كفالة شهرية للأيتام وأسرهم', { recurrence: 'monthly', ...zakat });
    const widows = await act('project', 'كفالة الأرامل', sponsorship.id, 'دعم شهري للأرامل المعيلات', { recurrence: 'monthly', ...zakat });
    const food = await act('program', 'الأمن الغذائي', social.id);
    const ramadan = await act('project', 'سلة رمضان', food.id, 'سلة غذائية شهرية خلال رمضان', { recurrence: 'yearly', ...zakat });
    const health = await act('axis', 'الرعاية الصحية', null);
    const treatment = await act('program', 'العلاج', health.id);
    const surgery = await act('project', 'دعم العمليات الجراحية', treatment.id, 'المساهمة في تكاليف العمليات', {
      recurrence: 'once', multiServices: true,
      services: [{ name: 'عملية جراحية', cost: 25000 }, { name: 'أشعة وتحاليل', cost: 2000 }, { name: 'أدوية بعد العملية', cost: 1500 }],
    });
    const education = await act('axis', 'التعليم', null);
    const students = await act('program', 'دعم الطلاب', education.id);
    const school = await act('project', 'الحقيبة المدرسية', students.id, 'أدوات ومصروفات مدرسية', {
      recurrence: 'yearly', multiServices: true,
      services: [{ name: 'حقيبة مدرسية', cost: 400 }, { name: 'مصروفات دراسية', cost: 1100 }, { name: 'زي مدرسي', cost: 300 }],
    });

    // دليل حسابات موحد مع الموارد المالية وإدارة المشاريع
    await em.save(em.create(BeneficiarySettings, {
      organizationId: orgId,
      contributionDebitCode: '1101', contributionDebitName: 'الصندوق',
      contributionCreditCode: '4160', contributionCreditName: 'إيرادات مساهمات المستفيدين',
      contributionDescription: 'مساهمة مستفيد في تكلفة الحالة',
    }));

    const team: DemoTeam = {
      admin: actorOf(orgId, admin, ALL_PERMISSIONS, true),
      researcher: actorOf(orgId, researcher, roleCodes.researcher),
      caseManager: actorOf(orgId, caseManager, roleCodes.caseManager),
      quality: actorOf(orgId, quality, roleCodes.quality),
      fundraiser: actorOf(orgId, fundraiser, roleCodes.fundraiser),
      finance: actorOf(orgId, finance, roleCodes.finance),
      projectsManager: actorOf(orgId, projectsManager, roleCodes.projectsManager),
      roles: {
        researcher: researcherRole.id, caseManager: managerRole.id, quality: qualityRole.id,
        fundraiser: fundraiserRole.id, finance: financeRole.id, projectsManager: projectsRole.id,
      },
    };
    return {
      team,
      tree: {
        axes: { social: social.id, health: health.id, education: education.id },
        programs: { sponsorship: sponsorship.id, food: food.id, treatment: treatment.id, students: students.id },
        projects: { orphans: orphans.id, widows: widows.id, ramadan: ramadan.id, surgery: surgery.id, school: school.id },
      },
      accounts: [
        { role: 'مدير الجمعية (كل الصلاحيات)', email: admin.email },
        { role: 'باحث اجتماعي', email: researcher.email },
        { role: 'مدير الحالات', email: caseManager.email },
        { role: 'مراجع الجودة', email: quality.email },
        { role: 'مسؤول تنمية الموارد', email: fundraiser.email },
        { role: 'المدير المالي', email: finance.email },
        { role: 'مدير المشاريع', email: projectsManager.email },
      ],
    };
  }

  async cases(orgId: string, team: DemoTeam, tree: DemoTree, portalPassword: string): Promise<DemoCases> {
    const portalHash = await bcrypt.hash(portalPassword, 12);
    const repo = this.db.getRepository(Beneficiary);
    // أرقام الهوية بصيغة سعودية: المواطن يبدأ بـ 1 والمقيم بـ 2
    const people = [
      { fullName: 'فاطمة عبدالله الزهراني', nationalId: '1085031214', nationality: 'سعودي', residency: 'citizen', gender: 'female', category: 'widow', maritalStatus: 'widowed', city: 'الرياض', monthlyIncome: 900, housingType: 'rented', monthlyRent: 700, portal: true,
        family: [['يوسف', 'ابن', 'male', '2014-03-02', 'الصف الخامس'], ['مريم', 'ابنة', 'female', '2017-09-10', 'الصف الثاني']] },
      { fullName: 'محمد عبدالعزيز الحربي', nationalId: '1070110514', nationality: 'سعودي', residency: 'citizen', gender: 'male', category: 'patient', maritalStatus: 'married', city: 'جدة', monthlyIncome: 1500, housingType: 'owned', portal: true,
        family: [['سعاد', 'زوجة', 'female', '1975-01-20', 'ربة منزل']] },
      { fullName: 'أمينة محمود العتيبي', nationalId: '1092082014', nationality: 'سعودي', residency: 'citizen', gender: 'female', category: 'orphan', maritalStatus: 'single', city: 'مكة المكرمة', monthlyIncome: 0, housingType: 'shared', portal: true,
        family: [['آدم', 'أخ', 'male', '2012-06-15', 'متوسط'], ['هبة', 'أخت', 'female', '2010-11-01', 'ثانوي']] },
      { fullName: 'سامي فهد القحطاني', nationalId: '1065051014', nationality: 'سعودي', residency: 'citizen', gender: 'male', category: 'elderly', maritalStatus: 'widowed', city: 'الرياض', monthlyIncome: 1200, housingType: 'rented', monthlyRent: 500, portal: true, family: [] },
      { fullName: 'نادية حسين الغامدي', nationalId: '1088070714', nationality: 'سعودي', residency: 'citizen', gender: 'female', category: 'poor_family', maritalStatus: 'divorced', city: 'الدمام', monthlyIncome: 1100, housingType: 'rented', monthlyRent: 600, portal: true,
        family: [['عمر', 'ابن', 'male', '2011-02-12', 'متوسط'], ['ليلى', 'ابنة', 'female', '2015-08-08', 'ابتدائي'], ['سلمى', 'ابنة', 'female', '2019-04-04', 'حضانة']] },
      { fullName: 'كريم أحمد مصطفى', nationalId: '2301030314', nationality: 'مصري', residency: 'resident', gender: 'male', category: 'student', maritalStatus: 'single', city: 'المدينة المنورة', monthlyIncome: 0, housingType: 'shared', portal: false, family: [] },
    ] as const;

    const ids: string[] = [];
    for (const [i, p] of people.entries()) {
      const { family, portal, ...data } = p;
      const b = await repo.save(repo.create({
        ...data, organizationId: orgId, fileNo: i + 1, status: 'new', source: portal ? 'portal' : 'staff',
        phone: `05${String(51234560 + i * 1111).padStart(8, '0')}`, portalPasswordHash: portal ? portalHash : null,
        createdBy: portal ? null : team.caseManager.id,
      } as Partial<Beneficiary>));
      for (const [fullName, relation, gender, birthDate, occupation] of family) {
        await this.db.getRepository(FamilyMember).save({ organizationId: orgId, beneficiaryId: b.id, fullName, relation, gender: gender as 'male', birthDate, occupation, monthlyIncome: 0 });
      }
      ids.push(b.id);
    }

    const submit = (i: number, projectId: string, reason: string, members: number, amount?: number, services?: string[]) =>
      this.requests.create({ organizationId: orgId, userId: people[i].portal ? null : team.caseManager.id, name: people[i].portal ? people[i].fullName : team.caseManager.fullName }, {
        beneficiaryId: ids[i], projectId, services,
        applicationData: { reason, members, amount, has_income: false },
      }, people[i].portal ? 'portal' : 'staff');
    const review = (id: string, decision: 'approve' | 'reject' | 'return', notes?: string) =>
      this.requests.decide(team.caseManager, id, { decision, notes });
    const research = (id: string, need: string, recommendation: string, housing = 'سيئة', noIncome = true, supportPercent?: number) =>
      this.requests.decide(team.researcher, id, {
        decision: 'approve', notes: 'تمت الزيارة الميدانية',
        formData: {
          visit_date: daysAgo(5), housing, rooms: 2, no_income: noIncome, income_verified: true, need, recommendation,
          assessment: supportPercent ? { decision: 'partial', percent: supportPercent } : { decision: 'full' },
        },
      });
    // مرحلة اللجنة بلا دور محدد، فيقررها مدير الجمعية
    const committee = (id: string, notes: string, estimatedCost?: number) =>
      this.requests.decide(team.admin, id, { decision: 'approve', notes, estimatedCost });
    const p = tree.projects;

    // 1) أرملة: معتمد نهائيًا بكفالة سنوية، ويُحمَّل لاحقًا على دفعة زكاة من نظام إدارة المشاريع
    const widow = await submit(0, p.widows, 'أرملة وأعول طفلين والإيجار أكبر من دخلي', 3, 1000);
    await review(widow, 'approve', 'البيانات مكتملة');
    await research(widow, 'عالية', 'كفالة شهرية 1,000 ريال لمدة سنة');
    await committee(widow, 'وافقت اللجنة على كفالة شهرية لمدة 12 شهرًا', 12000);
    await review(widow, 'approve', 'اعتماد نهائي');

    // 2) علاج: الباحث قيّمه "مستحق بنسبة" 70% على الجمعية و30% على المستفيد، وينتظر رفع إثبات المساهمة من البوابة
    const surgery = await submit(1, p.surgery, 'أحتاج إلى عملية قلب مفتوح والتأمين لا يغطيها', 2, 25000, ['عملية جراحية']);
    await review(surgery, 'approve');
    await research(surgery, 'متوسطة', 'تستطيع الأسرة المساهمة بجزء من التكلفة', 'متوسطة', false, 70);
    await committee(surgery, 'الجمعية تتحمل 70% والمستفيد 30%');

    // 3) في مرحلة البحث الاجتماعي (وعليه فرصة تبرع موجهة لحالته بانتظار التدقيق المالي)
    const orphan = await submit(2, p.orphans, 'يتيمة الأب والأم وأعيش مع إخوتي عند خالتي', 3);
    await review(orphan, 'approve', 'محولة للباحث');

    // 4) معاد لمقدم الطلب لاستكمال البيانات
    const r4 = await submit(3, p.ramadan, 'مسن وأعيش وحدي', 1);
    await review(r4, 'return', 'نرجو رفع صورة الهوية وإيصال المعاش');

    // 5) حقيبة مدرسية: معتمد نهائيًا، ويُصرف بفاتورة مزود الخدمة
    const school = await submit(4, p.school, 'لديّ ثلاثة أطفال في المدارس وأحتاج إلى أدوات مدرسية', 4, 1500, ['حقيبة مدرسية', 'مصروفات دراسية']);
    await review(school, 'approve');
    await research(school, 'متوسطة', 'حقيبة مدرسية ومصروفات دراسية');
    await committee(school, 'الموافقة على الحقيبة والمصروفات الدراسية');
    await review(school, 'approve', 'اعتماد نهائي');

    // 6) مرفوض
    const r6 = await submit(5, p.school, 'طالب جامعي وأحتاج إلى مصاريف دراسية', 1, 3000, ['مصروفات دراسية']);
    await review(r6, 'reject', 'المشروع مخصص لطلاب المدارس فقط، ويمكن التقديم على منحة الجامعة لاحقًا');

    // 7) طلب جديد في أول مرحلة
    await submit(4, p.ramadan, 'أحتاج إلى سلة رمضان للأسرة', 4);

    // 8) معتمد نهائيًا وينتظر التحميل على دفعة داعم (لتجربة إدارة الدعم بنفسك)
    const r8 = await submit(3, p.surgery, 'أحتاج إلى أشعة وتحاليل قبل عملية في الركبة', 1, 2000, ['أشعة وتحاليل']);
    await review(r8, 'approve');
    await research(r8, 'عالية', 'تغطية الأشعة والتحاليل بالكامل');
    await committee(r8, 'الموافقة على تغطية الأشعة والتحاليل');
    await review(r8, 'approve', 'اعتماد نهائي');

    const tickets = this.db.getRepository(Ticket);
    await tickets.save([
      { organizationId: orgId, ticketNo: 1, beneficiaryId: ids[0], type: 'inquiry', subject: 'موعد صرف الكفالة', message: 'متى يتم صرف الكفالة كل شهر؟', status: 'answered',
        reply: 'يتم الصرف في الأسبوع الأول من كل شهر بتحويل إلى حسابك البنكي', repliedByName: team.caseManager.fullName, repliedAt: new Date() },
      { organizationId: orgId, ticketNo: 2, beneficiaryId: ids[3], type: 'complaint', subject: 'تأخر الرد على الطلب', message: 'قدّمت طلبي منذ أسبوع ولم يتواصل معي أحد', status: 'open' },
      { organizationId: orgId, ticketNo: 3, beneficiaryId: ids[4], type: 'suggestion', subject: 'مواعيد مسائية', message: 'أقترح توفير مواعيد مسائية لاستلام المساعدات', status: 'open' },
    ]);

    return {
      widow, school, orphan, surgery,
      portalUsers: people.filter((x) => x.portal).map((x) => ({ fullName: x.fullName, nationalId: x.nationalId })),
    };
  }
}
