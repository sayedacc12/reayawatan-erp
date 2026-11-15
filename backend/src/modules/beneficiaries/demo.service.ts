import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization, Permission, Role, User } from '../../core/entities';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { BeneficiariesService } from './beneficiaries.service';
import { normalizeFields, normalizeRules } from './dynamic-forms';
import { Activity, Beneficiary, BeneficiarySettings, DynamicForm, FamilyMember, Ticket, Workflow, WorkflowStage } from './entities';
import { RequestsService } from './requests.service';

const DEMO_SLUG = 'demo';
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
};

/**
 * ينشئ جمعية تجريبية كاملة للشرح: أنشطة، نماذج، سير عمل، موظفين بأدوار،
 * مستفيدين مسجلين من البوابة، وطلبات في مراحل مختلفة.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly db: DataSource,
    private readonly requests: RequestsService,
    private readonly beneficiaries: BeneficiariesService,
  ) {}

  async create() {
    if (await this.db.getRepository(Organization).exists({ where: { slug: DEMO_SLUG } })) {
      throw new ConflictException('الجمعية التجريبية موجودة بالفعل (المعرّف demo)');
    }
    const staffPassword = `Demo-${randomBytes(4).toString('hex')}`;
    const portalPassword = `Portal-${randomBytes(3).toString('hex')}`;
    const org = await this.db.getRepository(Organization).save({ name: 'جمعية سنابل الخير (تجريبية)', slug: DEMO_SLUG });
    try {
      const staff = await this.db.transaction((em) => this.seedSetup(em, org.id, staffPassword));
      const portalUsers = await this.seedCases(org.id, staff, portalPassword);
      return {
        organization: { name: org.name, slug: org.slug },
        staffPassword,
        staff: staff.accounts,
        portalPassword,
        portalUsers,
      };
    } catch (e) {
      this.logger.error(`Demo seeding failed: ${(e as Error).message}`);
      await this.db.getRepository(Organization).delete({ id: org.id });
      throw e;
    }
  }

  private async seedSetup(em: EntityManager, orgId: string, password: string) {
    const hash = await bcrypt.hash(password, 12);
    const perms = (codes: string[]) => em.find(Permission, { where: { code: In(codes) } });

    const researcherRole = await em.save(em.create(Role, {
      organizationId: orgId, name: 'باحث اجتماعي', description: 'يجري البحث الميداني ويعبّي نموذج البحث',
      permissions: await perms([P.read, P.requestsRead, P.requestsProcess, P.research]),
    }));
    const managerRole = await em.save(em.create(Role, {
      organizationId: orgId, name: 'مدير الحالات', description: 'يراجع الطلبات ويعتمدها نهائيًا ويصرف المساعدات',
      permissions: await perms([P.read, P.manage, P.requestsRead, P.requestsCreate, P.requestsProcess, P.aid, P.tickets, P.documents]),
    }));
    const user = (fullName: string, email: string, extra: Partial<User>) => em.save(em.create(User, {
      organizationId: orgId, fullName, email, passwordHash: hash, ...extra,
    }));
    const admin = await user('مدير الجمعية التجريبية', 'demo-admin@sanabelerp.com', { isSuperadmin: true });
    await user('منى عبد الرحمن', 'demo-researcher@sanabelerp.com', { roles: [researcherRole] });
    await user('خالد إبراهيم', 'demo-manager@sanabelerp.com', { roles: [managerRole] });

    const appForm = await em.save(em.create(DynamicForm, {
      organizationId: orgId, name: 'نموذج بيانات الطلب', description: 'يعبّيه المستفيد عند التقديم',
      fields: normalizeFields([
        { key: 'reason', label: 'سبب الطلب', type: 'textarea', required: true, placeholder: 'اشرح ظروفك باختصار' },
        { key: 'members', label: 'عدد أفراد الأسرة', type: 'number', required: true },
        { key: 'amount', label: 'المبلغ المطلوب تقريبًا', type: 'number' },
        { key: 'has_income', label: 'يوجد دخل ثابت للأسرة', type: 'checkbox' },
      ]),
    }));
    const researchForm = await em.save(em.create(DynamicForm, {
      organizationId: orgId, name: 'نموذج البحث الاجتماعي', description: 'يعبّيه الباحث بعد الزيارة الميدانية، والنظام بيحسب نتيجة التقييم',
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
      { name: 'لجنة الحالات', instructions: 'مناقشة الحالة وتحديد نوع المساعدة' },
      { name: 'تأكيد مساهمة المستفيد', kind: 'contribution' as const, instructions: 'راجع إثبات المساهمة اللي رفعه المستفيد من البوابة', roleId: managerRole.id },
      { name: 'الاعتماد النهائي', instructions: 'اعتماد الطلب من مدير الحالات', roleId: managerRole.id },
    ];
    for (const [i, s] of stages.entries()) {
      await em.save(em.create(WorkflowStage, { organizationId: orgId, workflowId: workflow.id, sortOrder: i + 1, canReturn: true, canReject: true, ...s }));
    }

    let order = 0;
    const act = (level: Activity['level'], name: string, parentId: string | null, description?: string, rules: Partial<Activity> = {}) =>
      em.save(em.create(Activity, { organizationId: orgId, level, name, parentId, description: description ?? null, sortOrder: ++order, ...rules }));
    const social = await act('axis', 'الرعاية الاجتماعية', null);
    const sponsorship = await act('program', 'كفالة الأسر', social.id);
    const orphans = await act('project', 'كفالة الأيتام', sponsorship.id, 'كفالة شهرية للأيتام وأسرهم', { recurrence: 'monthly' });
    const widows = await act('project', 'كفالة الأرامل', sponsorship.id, 'دعم شهري للأرامل المعيلات', { recurrence: 'monthly' });
    const food = await act('program', 'الأمن الغذائي', social.id);
    const ramadan = await act('project', 'سلة رمضان', food.id, 'سلة غذائية شهرية خلال رمضان', { recurrence: 'yearly' });
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

    await em.save(em.create(BeneficiarySettings, {
      organizationId: orgId,
      contributionDebitCode: '1101', contributionDebitName: 'الصندوق',
      contributionCreditCode: '4103', contributionCreditName: 'إيرادات مساهمات المستفيدين',
      contributionDescription: 'مساهمة مستفيد في تكلفة الحالة',
    }));

    const actor: OrgUser = {
      id: admin.id, organizationId: orgId, organizationName: null, organizationSlug: DEMO_SLUG, email: admin.email, username: null,
      fullName: admin.fullName, isSuperadmin: true, isPlatformAdmin: false,
      permissions: Object.values(P),
    };
    return {
      actor,
      researcherName: 'منى عبد الرحمن',
      managerName: 'خالد إبراهيم',
      projects: { orphans: orphans.id, widows: widows.id, ramadan: ramadan.id, surgery: surgery.id, school: school.id },
      accounts: [
        { role: 'مدير الجمعية (كل الصلاحيات)', email: admin.email },
        { role: 'باحث اجتماعي', email: 'demo-researcher@sanabelerp.com' },
        { role: 'مدير الحالات', email: 'demo-manager@sanabelerp.com' },
      ],
    };
  }

  private async seedCases(orgId: string, setup: Awaited<ReturnType<DemoService['seedSetup']>>, portalPassword: string) {
    const portalHash = await bcrypt.hash(portalPassword, 12);
    const repo = this.db.getRepository(Beneficiary);
    const people = [
      { fullName: 'فاطمة السيد عبد الله', nationalId: '28503121401234', gender: 'female', category: 'widow', maritalStatus: 'widowed', city: 'القاهرة', monthlyIncome: 900, housingType: 'rented', monthlyRent: 700, portal: true,
        family: [['يوسف', 'ابن', 'male', '2014-03-02', 'الصف الخامس'], ['مريم', 'ابنة', 'female', '2017-09-10', 'الصف الثاني']] },
      { fullName: 'محمد عبد العزيز حسن', nationalId: '27011051402345', gender: 'male', category: 'patient', maritalStatus: 'married', city: 'الجيزة', monthlyIncome: 1500, housingType: 'owned', portal: true,
        family: [['سعاد', 'زوجة', 'female', '1975-01-20', 'ربة منزل']] },
      { fullName: 'أمينة محمود رمضان', nationalId: '29208201403456', gender: 'female', category: 'orphan', maritalStatus: 'single', city: 'الإسكندرية', monthlyIncome: 0, housingType: 'shared', portal: true,
        family: [['آدم', 'أخ', 'male', '2012-06-15', 'إعدادي'], ['هبة', 'أخت', 'female', '2010-11-01', 'ثانوي']] },
      { fullName: 'سامي فتحي إبراهيم', nationalId: '26505101404567', gender: 'male', category: 'elderly', maritalStatus: 'widowed', city: 'القاهرة', monthlyIncome: 1200, housingType: 'rented', monthlyRent: 500, portal: true, family: [] },
      { fullName: 'نادية حسين علي', nationalId: '28807071405678', gender: 'female', category: 'poor_family', maritalStatus: 'divorced', city: 'طنطا', monthlyIncome: 1100, housingType: 'rented', monthlyRent: 600, portal: true,
        family: [['عمر', 'ابن', 'male', '2011-02-12', 'إعدادي'], ['ليلى', 'ابنة', 'female', '2015-08-08', 'ابتدائي'], ['سلمى', 'ابنة', 'female', '2019-04-04', 'حضانة']] },
      { fullName: 'كريم أحمد مصطفى', nationalId: '20103031406789', gender: 'male', category: 'student', maritalStatus: 'single', city: 'المنصورة', monthlyIncome: 0, housingType: 'shared', portal: false, family: [] },
    ] as const;

    const ids: string[] = [];
    for (const [i, p] of people.entries()) {
      const { family, portal, ...data } = p;
      const b = await repo.save(repo.create({
        ...data, organizationId: orgId, fileNo: i + 1, status: 'new', source: portal ? 'portal' : 'staff',
        phone: `010${String(12345670 + i * 1111).padStart(8, '0')}`, portalPasswordHash: portal ? portalHash : null,
        createdBy: portal ? null : setup.actor.id,
      } as Partial<Beneficiary>));
      for (const [fullName, relation, gender, birthDate, occupation] of family) {
        await this.db.getRepository(FamilyMember).save({ organizationId: orgId, beneficiaryId: b.id, fullName, relation, gender: gender as 'male', birthDate, occupation, monthlyIncome: 0 });
      }
      ids.push(b.id);
    }

    const actorOf = (name: string, i: number) => ({ organizationId: orgId, userId: null, name: people[i].portal ? people[i].fullName : name });
    const submit = (i: number, projectId: string, reason: string, members: number, amount?: number, services?: string[]) =>
      this.requests.create(actorOf(setup.actor.fullName, i), {
        beneficiaryId: ids[i], projectId, services,
        applicationData: { reason, members, amount, has_income: false },
      }, people[i].portal ? 'portal' : 'staff');
    const decide = (id: string, decision: 'approve' | 'reject' | 'return', notes?: string, formData?: Record<string, unknown>) =>
      this.requests.decide(setup.actor, id, { decision, notes, formData });
    const research = (need: string, recommendation: string, housing = 'سيئة', noIncome = true, supportPercent?: number) => ({
      visit_date: daysAgo(5), housing, rooms: 2, no_income: noIncome, income_verified: true, need, recommendation,
      assessment: supportPercent ? { decision: 'partial', percent: supportPercent } : { decision: 'full' },
    });

    // 1) معتمد نهائيًا ومصروف عليه
    const r1 = await submit(0, setup.projects.widows, 'أرملة وأعول طفلين والإيجار أكبر من دخلي', 3, 1000);
    await decide(r1, 'approve', 'البيانات مكتملة');
    await decide(r1, 'approve', 'تمت الزيارة', research('عالية', 'كفالة شهرية 1000 جنيه'));
    await decide(r1, 'approve', 'وافقت اللجنة على كفالة شهرية');
    await decide(r1, 'approve', 'اعتماد نهائي');
    await this.beneficiaries.addAid(setup.actor, ids[0], { aidType: 'cash', amount: 1000, disbursedOn: daysAgo(2), description: 'كفالة شهر', referenceNo: 'R-1001', requestId: r1 });

    // 2) علاج: الباحث قيّمه "مستحق بنسبة" 70% على الجمعية و30% على المستفيد، ومستني يرفع إثبات المساهمة من البوابة
    const r2 = await submit(1, setup.projects.surgery, 'محتاج عملية قلب مفتوح والتأمين لا يغطي', 2, 25000, ['عملية جراحية']);
    await decide(r2, 'approve');
    await decide(r2, 'approve', undefined, research('متوسطة', 'الأسرة تقدر تساهم بجزء من التكلفة', 'متوسطة', false, 70));
    await decide(r2, 'approve', 'الجمعية تتحمل 70% والمستفيد 30%');

    // 3) في مرحلة البحث الاجتماعي
    const r3 = await submit(2, setup.projects.orphans, 'يتيمة الأب والأم وأعيش مع إخوتي عند خالتي', 3);
    await decide(r3, 'approve', 'محولة للباحث');

    // 4) راجع لمقدم الطلب لاستكمال البيانات
    const r4 = await submit(3, setup.projects.ramadan, 'مسن وأعيش وحدي', 1);
    await decide(r4, 'return', 'برجاء رفع صورة البطاقة وإيصال المعاش');

    // 5) في لجنة الحالات
    const r5 = await submit(4, setup.projects.school, 'ثلاثة أطفال في المدارس ومحتاجة أدوات', 4, 1500, ['حقيبة مدرسية', 'مصروفات دراسية']);
    await decide(r5, 'approve');
    await decide(r5, 'approve', undefined, research('متوسطة', 'حقيبة مدرسية لكل طفل'));

    // 6) مرفوض
    const r6 = await submit(5, setup.projects.school, 'طالب جامعي ومحتاج مصاريف', 1, 3000, ['مصروفات دراسية']);
    await decide(r6, 'reject', 'المشروع مخصص لطلاب المدارس فقط، يمكن التقديم على منحة الجامعة لاحقًا');

    // 7) طلب جديد في أول مرحلة
    await submit(4, setup.projects.ramadan, 'محتاجة سلة رمضان للأسرة', 4);

    const tickets = this.db.getRepository(Ticket);
    await tickets.save([
      { organizationId: orgId, ticketNo: 1, beneficiaryId: ids[0], type: 'inquiry', subject: 'موعد صرف الكفالة', message: 'إمتى بيتم صرف الكفالة كل شهر؟', status: 'answered',
        reply: 'الصرف أول أسبوع من كل شهر من مقر الجمعية', repliedByName: setup.managerName, repliedAt: new Date() },
      { organizationId: orgId, ticketNo: 2, beneficiaryId: ids[3], type: 'complaint', subject: 'تأخر الرد على الطلب', message: 'قدمت من أسبوع ومحدش كلمني', status: 'open' },
      { organizationId: orgId, ticketNo: 3, beneficiaryId: ids[4], type: 'suggestion', subject: 'مواعيد مسائية', message: 'ياريت يكون فيه مواعيد مسائية لاستلام المساعدات', status: 'open' },
    ]);

    return people.filter((p) => p.portal).map((p) => ({ fullName: p.fullName, nationalId: p.nationalId }));
  }
}
