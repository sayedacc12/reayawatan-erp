import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Permission, Role } from '../../core/entities';
import { OrgUser } from '../../core/auth/decorators';
import { ActivitiesService } from '../crm/activities.service';
import { CrmCore } from '../crm/crm-core.service';
import { CRM_PERMISSIONS as CR } from '../crm/crm.manifest';
import { LeadsService } from '../crm/leads.service';
import { PartiesService } from '../crm/parties.service';
import { Lead } from '../website/entities/website.entity';
import { LeadsService as WebLeads } from '../website/leads.service';
import { DemoTeam, daysAhead } from './demo-context';

const at = (days: number, hour = 10) => {
  const d = new Date(`${daysAhead(days)}T00:00:00+03:00`);
  d.setHours(d.getHours() + hour);
  return d.toISOString();
};

/**
 * علاقات العملاء في الشركة التجريبية: ربط العملاء والأعضاء والمتطوعين والشركاء في سجل الجهات الموحد،
 * وعملاء محتملون في كل الحالات (من نماذج الموقع والمعرض والإدخال المباشر، جديد ومتأخر عن المهلة ومؤهل ومحوّل وغير مؤهل)،
 * وأنشطة منجزة ومجدولة ومتأخرة، وجهة مكررة تنتظر الدمج. تُنفَّذ عبر خدمات الوحدة كما لو نفذها الموظفون.
 */
@Injectable()
export class CrmSeed {
  constructor(
    private readonly db: DataSource, private readonly core: CrmCore, private readonly parties: PartiesService,
    private readonly leads: LeadsService, private readonly activities: ActivitiesService, private readonly web: WebLeads,
  ) {}

  /** مسؤول تطوير الأعمال يدير علاقات العملاء كاملة (مدير المبيعات والتسويق) */
  private async grant(team: DemoTeam): Promise<OrgUser> {
    const codes = Object.values(CR);
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: team.roles.fundraiser }, relations: { permissions: true } });
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(codes) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...team.fundraiser, permissions: [...team.fundraiser.permissions, ...codes] };
  }

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    const sales = await this.grant(team);
    await this.core.settings(org);
    await this.core.saveSettings(admin, { slaHours: 24, assignMode: 'manual', team: [sales.id, admin.id], webTopics: ['consultation', 'booking'], partyVisibility: 'all' });
    // استقبال طلبات الموقع معطل افتراضيًا: بعد تفعيل «طلب استشارة» و«حجز جلسة» تدخل طلبات الموقع السابقة منهما عملاءَ محتملين (كما لو وصلت بعد التفعيل)
    const web = await this.db.getRepository(Lead).find({ where: { organizationId: org, source: In(['consultation', 'booking']) }, order: { leadNo: 'ASC' } });
    for (const l of web) await this.web.toCrm(org, l);
    // ربط السجلات الحالية في الأنظمة بسجل الجهات
    await this.parties.sync(org, true);
    const party = async (name: string) => ((await this.db.query('SELECT id FROM crm_parties WHERE organization_id = $1 AND name = $2 AND is_active', [org, name]))[0]?.id ?? null) as string | null;

    // عميل رئيسي (من الفوترة): مسؤول وموافقات وشخص اتصال
    const amal = await party('شركة الأمل للتجارة');
    if (amal) {
      await this.parties.setOwner(admin, amal, sales.id);
      await this.parties.update(sales, amal, { kind: 'org', name: 'شركة الأمل للتجارة', phone: '0112345678', email: 'csr@alamal-demo.sa', city: 'الرياض', vatNumber: '300012345600003', crNumber: '1010456789', tags: ['عملاء رئيسيون', 'مسؤولية اجتماعية'], notes: 'تموّل برامج صحية مجتمعية ضمن مسؤوليتها الاجتماعية، وتطلب تقرير أثر لكل برنامج. القرار عند لجنة المسؤولية الاجتماعية في الربع الأول.' });
      await this.parties.setConsents(sales, amal, { items: [{ channel: 'email', granted: true, source: 'طلب الشركة في اجتماع التعارف' }, { channel: 'whatsapp', granted: true, source: 'طلب الشركة في اجتماع التعارف' }], doNotContact: false });
      await this.parties.saveContact(sales, amal, { name: 'م. سلطان الدوسري', title: 'مدير المسؤولية الاجتماعية', phone: '0551239876', email: 'sultan@alamal-demo.sa', decisionRole: 'decision_maker', isPrimary: true });
      await this.parties.saveContact(sales, amal, { name: 'أ. هيفاء القحطاني', title: 'منسقة البرامج', phone: '0557654321', decisionRole: 'influencer', isPrimary: false });
      await this.activities.create(sales, { type: 'meeting', subject: 'اجتماع تعريفي بمقر الشركة', details: 'عرضنا منهجية قياس الأثر ونموذج تقرير الأثر.', done: true, outcome: 'طلبوا عرضًا لقياس أثر برنامجين صحيين يمولونهما.', partyId: amal });
      await this.activities.create(sales, { type: 'task', subject: 'إرسال عرض قياس الأثر', dueAt: at(3), done: false, partyId: amal });
    }
    const ahmad = await party('أحمد بن سعد الغامدي');
    if (ahmad) {
      await this.parties.setOwner(admin, ahmad, sales.id);
      await this.parties.setConsents(sales, ahmad, { items: [{ channel: 'whatsapp', granted: true, source: 'اختار واتساب وسيلةً مفضلة للتواصل' }, { channel: 'sms', granted: false, source: 'طلب عدم إرسال رسائل نصية' }], doNotContact: false });
      await this.activities.create(sales, { type: 'call', subject: 'متابعة بعد الدورة التدريبية', done: true, outcome: 'أبدى رضاه، وسأل عن الدورة القادمة.', partyId: ahmad });
      await this.activities.create(sales, { type: 'whatsapp', subject: 'إرسال جدول الدورات القادمة', dueAt: at(-2), done: false, partyId: ahmad });
    }

    // نشاط واحد لعدة عملاء، ورسالة لكل العملاء، بمسؤول ومتابع للاطلاع
    if (amal && ahmad) {
      await this.activities.create(sales, { type: 'meeting', subject: 'لقاء تعريفي مشترك ببرامج التدريب الصحي', dueAt: at(5), done: false, partyIds: [amal, ahmad], followerIds: [admin.id] });
    }
    await this.activities.create(sales, { type: 'email', subject: 'إرسال دليل خدمات الشركة', done: true, outcome: 'أُرسل الدليل بالبريد.', allParties: true, audienceRole: 'customer' }).catch(() => undefined);

    // جهة مكررة تنتظر الدمج (البريد نفسه لشركة الأمل): تُجرَّب من شاشة المكرر والدمج
    await this.parties.create(sales, { kind: 'org', name: 'الأمل للتجارة', email: 'csr@alamal-demo.sa', city: 'الرياض', source: 'event', tags: ['ملتقى الرياض'], allowDuplicate: true, notes: 'سُجلت في الملتقى قبل البحث في السجل.' });

    // عملاء محتملون: أول طلب استشارة من الموقع دخل أعلاه بعد تفعيل الاستقبال. يُسند لمسؤول تطوير الأعمال
    const [first] = await this.db.query(`SELECT id FROM crm_leads WHERE organization_id = $1 AND source = 'website' ORDER BY created_at LIMIT 1`, [org]);
    if (first) {
      await this.leads.assign(admin, first.id, sales.id);
      await this.activities.create(sales, { type: 'call', subject: 'اتصال للتعرف على الاحتياج', done: true, outcome: 'يرغبون في قياس أثر برنامج التوعية بالسكري، وطلبوا عرضًا بالتكلفة.', leadId: first.id });
      await this.leads.setStatus(sales, first.id, { status: 'qualified', note: 'الاحتياج والميزانية واضحان' });
      await this.activities.create(sales, { type: 'meeting', subject: 'اجتماع عرض منهجية قياس الأثر', dueAt: at(5, 11), done: false, leadId: first.id });
    }
    const mk = (dto: Record<string, unknown>, by: OrgUser = sales) => this.leads.create(by, { source: 'manual', allowDuplicate: true, ...dto } as never);
    const horizon = await mk({ name: 'أ. ماجد الشهري', company: 'جمعية الأفق الصحية', title: 'المدير التنفيذي', phone: '0553214567', email: 'majed@ofuq-demo.sa', city: 'الرياض', interest: 'strategy', source: 'event', campaign: 'ملتقى القطاع غير الربحي الصحي', message: 'يرغبون في بناء خطة استراتيجية خمسية للجمعية.', ownerId: sales.id });
    await this.activities.create(sales, { type: 'call', subject: 'تأكيد النطاق والمدة', done: true, outcome: 'خطة خمسية بورش عمل مع مجلس الإدارة، والبدء بعد شهرين.', leadId: horizon.id });
    await this.leads.convert(sales, horizon.id, { nextSubject: 'إعداد عرض فني ومالي للخطة الاستراتيجية', nextDueAt: at(2) });

    const binaa = await mk({ name: 'م. ريان الحربي', company: 'مؤسسة البناء الصحية', phone: '0552468135', city: 'جدة', interest: 'governance', source: 'referral', message: 'ترشيح من جمعية عناية لمراجعة اللوائح والحوكمة.', ownerId: sales.id });
    await this.activities.create(sales, { type: 'email', subject: 'إرسال الملف التعريفي للشركة', done: true, outcome: 'أُرسل الملف، وننتظر تحديد موعد.', leadId: binaa.id });

    // عميل محتمل جديد تجاوز مهلة التواصل الأول دون تواصل
    const late = await mk({ name: 'خالد بن محمد العتيبي', phone: '0559081726', interest: 'training', source: 'phone', message: 'اتصل يسأل عن برنامج تدريب صحي لمتطوعي جمعيته.', ownerId: sales.id });
    await this.db.query(`UPDATE crm_leads SET created_at = now() - interval '30 hours', due_at = now() - interval '6 hours' WHERE organization_id = $1 AND id = $2`, [org, late.id]);
    // عميل محتمل بلا مسؤول ينتظر التوزيع
    await mk({ name: 'سارة الزهراني', email: 'sara.z@example.com', interest: 'impact', source: 'linkedin', message: 'سألت عبر حساب الشركة في لينكدإن عن قياس أثر برنامج توعوي.' }, admin);
    // غير مؤهل
    const spam = await mk({ name: 'عرض تسويقي', email: 'offers@marketing-demo.com', interest: 'inquiry', source: 'social', message: 'نقدم خدمات زيادة المتابعين.', ownerId: sales.id });
    await this.leads.setStatus(sales, spam.id, { status: 'disqualified', reason: 'spam', note: 'رسالة إعلانية' });

    // استيراد قائمة زوار جناح الشركة في الملتقى
    await this.leads.import(sales, {
      source: 'event', interest: 'consulting', campaign: 'ملتقى القطاع غير الربحي الصحي', dryRun: false,
      rows: [
        { name: 'عبدالعزيز القرني', phone: '0551112299', city: 'الرياض' },
        { name: 'لمى الشمري', email: 'lama.sh@example.com', city: 'الرياض', notes: 'مهتمة بقياس أثر برامج الأطفال' },
        { name: 'تركي المالكي', phone: '0503334455', city: 'جدة' },
      ],
    });
    // نشاط متأخر لمدير النظام
    await this.activities.create(admin, { type: 'task', subject: 'مراجعة توزيع العملاء المحتملين على الفريق', dueAt: at(-1), done: false });
  }
}
