import { Injectable } from '@nestjs/common';
import { OrgUser } from '../../core/auth/decorators';
import { DonorsService } from '../fundraising/donors.service';
import { FundraisingService } from '../fundraising/fundraising.service';
import { OpportunityDto } from '../fundraising/opportunities.dto';
import { FundraisingSettingsService } from '../fundraising/settings.service';
import { SupportService } from '../projects/support.service';
import { TransfersService } from '../projects/transfers.service';
import { DemoTeam, DemoTree, daysAgo, daysAhead } from './demo-context';
import { DemoCases } from './seed-beneficiaries';
import { DemoExtraProjects } from './seed-projects';

/**
 * الموارد المالية وإدارة الدعم معًا، لتظهر الدورة كاملة:
 * داعم ← فرصة تبرع ← اعتماد ← دفعات ← تحميل طلب مستفيد (محجوز) ← طلب صرف ← تنفيذ المالية (مخصوم) ← قيد.
 */
@Injectable()
export class FinanceSeed {
  constructor(
    private readonly settings: FundraisingSettingsService,
    private readonly donors: DonorsService,
    private readonly fundraising: FundraisingService,
    private readonly support: SupportService,
    private readonly transfers: TransfersService,
  ) {}

  async run(team: DemoTeam, tree: DemoTree, extra: DemoExtraProjects, cases: DemoCases) {
    const { admin, fundraiser, finance, projectsManager: pm } = team;
    const org = admin.organizationId;
    const p = tree.projects;

    // ---------- الإعدادات ----------
    await this.settings.updateGeneral(admin, {
      donorFields: [
        { key: 'employer', label: 'جهة العمل', type: 'text' },
        { key: 'contact_pref', label: 'طريقة التواصل المفضلة', type: 'select', options: ['اتصال', 'واتساب', 'بريد إلكتروني'] },
        { key: 'birth_date', label: 'تاريخ الميلاد', type: 'date' },
      ],
    });
    const item = <T extends { id: string }>(list: 'levels' | 'managers' | 'banks', dto: object) =>
      this.settings.createItem(admin, list, dto as never) as unknown as Promise<T>;
    const platinum = await item('levels', { name: 'بلاتيني', color: '#6b7280', minAmount: 100000, sortOrder: 1 });
    const gold = await item('levels', { name: 'ذهبي', color: '#d4a017', minAmount: 50000, sortOrder: 2 });
    const silver = await item('levels', { name: 'فضي', color: '#9ca3af', minAmount: 10000, sortOrder: 3 });
    const sara = await item('managers', { name: fundraiser.fullName, kind: 'employee', userId: fundraiser.id, phone: '0551112233', email: fundraiser.email });
    const agency = await item('managers', { name: 'مكتب الأثر للاستشارات', kind: 'external', entityName: 'مكتب الأثر للاستشارات', phone: '0114567890' });
    const rajhi = await item('banks', {
      bankName: 'مصرف الراجحي', accountName: 'جمعية سنابل الخير', accountNumber: '123608010012345', iban: 'SA0380000000608010012345', glCode: '1111', glName: 'البنك - مصرف الراجحي',
    });
    const ahli = await item('banks', {
      bankName: 'البنك الأهلي السعودي', accountName: 'جمعية سنابل الخير', accountNumber: '01400000123456', iban: 'SA4410000001400000123456', glCode: '1112', glName: 'البنك - البنك الأهلي السعودي',
    });
    await this.settings.saveStages(admin, {
      stages: [
        { name: 'التدقيق المالي', instructions: 'طابق الحوالة مع كشف الحساب وتأكد من توزيع البنود', roleId: team.roles.finance, canReject: true, canReturn: true },
        { name: 'اعتماد المدير التنفيذي', instructions: 'الاعتماد النهائي وإصدار سند القبض', canReject: true, canReturn: true },
      ],
    });

    // ---------- الداعمون ----------
    const donor = (dto: object) => this.donors.create(fundraiser, dto as never);
    const khair = await donor({ name: 'شركة الخير القابضة', type: 'entity', identifier: '1010123456', phone: '0112223344', email: 'csr@alkhair-holding.sa', city: 'الرياض', levelId: platinum.id, supportManagerId: sara.id, customData: { contact_pref: 'بريد إلكتروني' }, notes: 'تدعم مشاريع الأيتام والأرامل من زكاة الشركة سنويًا' });
    const omari = await donor({ name: 'عبدالرحمن بن سعيد العمري', type: 'individual', identifier: '1023456789', phone: '0503334455', city: 'جدة', levelId: gold.id, supportManagerId: sara.id, customData: { employer: 'أرامكو السعودية', contact_pref: 'واتساب' } });
    const birr = await donor({ name: 'مؤسسة البر الوقفية', type: 'entity', identifier: '7001234567', phone: '0126667788', email: 'grants@albirr.org.sa', city: 'مكة المكرمة', levelId: gold.id, supportManagerId: agency.id, customData: { contact_pref: 'بريد إلكتروني' } });
    const shifa = await donor({ name: 'صيدلية الشفاء', type: 'entity', identifier: '2050123456', phone: '0138889900', city: 'الدمام', levelId: silver.id, customData: { contact_pref: 'اتصال' } });
    const noura = await donor({ name: 'نورة بنت خالد السبيعي', type: 'individual', phone: '0545556677', city: 'الرياض', levelId: silver.id, supportManagerId: sara.id, customData: { contact_pref: 'واتساب' } });
    const fahad = await donor({ name: 'فهد بن ناصر المطيري', type: 'individual', phone: '0567778899', city: 'الرياض', customData: { employer: 'وزارة التعليم' } });

    // ---------- فرص التبرع ----------
    const create = async (dto: Omit<OpportunityDto, 'supportManagerId'> & { supportManagerId?: string | null }) => {
      const o = (await this.fundraising.create(fundraiser, dto as OpportunityDto)) as unknown as { id: string };
      return o.id;
    };
    const approveAll = async (id: string) => {
      await this.fundraising.decide(finance, id, { decision: 'approve', notes: 'الحوالة مطابقة لكشف الحساب' });
      await this.fundraising.decide(admin, id, { decision: 'approve', notes: 'معتمد' });
    };
    const batch = async (opportunityId: string, activityId?: string) => {
      const rows = await this.fundraising.listBatches(org, { opportunityId });
      return activityId ? rows.find((b) => b.activityId === activityId)! : rows[0];
    };

    // 1) زكاة نقدية موزعة بالنسب على ثلاثة مشاريع زكوية، للمواطنين والمقيمين، ولا تقبل حالات فيها مساهمة من المستفيد
    const o1 = await create({
      kind: 'cash', donorId: khair.id, supportManagerId: sara.id, date: daysAgo(40), totalAmount: 120000, bankAccountId: rajhi.id,
      transferReference: 'RJH-2026-00871', isZakat: true,
      conditions: { acceptsPatientContribution: false, categories: ['citizen', 'resident'], endDate: daysAhead(300) },
      conditionsText: 'تُصرف الزكاة على المستحقين داخل المملكة خلال سنة من تاريخ التبرع',
      lines: [
        { targetKind: 'program', activityId: p.orphans, mode: 'percent', percent: 50 },
        { targetKind: 'program', activityId: p.widows, mode: 'percent', percent: 30 },
        { targetKind: 'program', activityId: p.ramadan, mode: 'percent', percent: 20 },
      ],
    });
    await approveAll(o1);

    // 2) تبرع نقدي مقيد، يقبل مساهمة المستفيد، وحد أعلى للصرف على الحالة الواحدة
    const o2 = await create({
      kind: 'cash', donorId: omari.id, supportManagerId: sara.id, date: daysAgo(30), totalAmount: 60000, bankAccountId: ahli.id,
      transferReference: 'SNB-55120',
      conditions: { acceptsPatientContribution: true, maxSpend: 25000 },
      lines: [
        { targetKind: 'program', activityId: p.surgery, mode: 'amount', amount: 40000 },
        { targetKind: 'program', activityId: p.school, mode: 'amount', amount: 20000 },
      ],
    });
    await approveAll(o2);

    // 3) وعد بالدفع تشغيلي، سُدد جزء منه
    const o3 = await create({
      kind: 'pledge', donorId: birr.id, supportManagerId: agency.id, date: daysAgo(25), totalAmount: 30000,
      conditionsText: 'تُسدد على ثلاث دفعات ربع سنوية',
      lines: [{ targetKind: 'operational', activityId: extra.operations, mode: 'amount', amount: 30000 }],
    });
    await approveAll(o3);
    await this.fundraising.collect(fundraiser, o3, { date: daysAgo(20), amount: 10000, bankAccountId: rajhi.id, transferReference: 'RJH-2026-00912' });

    // 4) تبرع عيني لمشروع صرفه عام
    const o4 = await create({
      kind: 'in_kind', donorId: shifa.id, date: daysAgo(18), totalAmount: 8000,
      inKindDescription: '40 جهاز قياس سكر و2000 شريط فحص ومطويات توعوية',
      lines: [{ targetKind: 'program', activityId: extra.awareness, mode: 'amount', amount: 8000 }],
    });
    await approveAll(o4);

    // 5) تبرع نقدي للوقف
    const o5 = await create({
      kind: 'cash', donorId: noura.id, supportManagerId: sara.id, date: daysAgo(12), totalAmount: 25000, bankAccountId: rajhi.id,
      transferReference: 'RJH-2026-01033',
      lines: [{ targetKind: 'waqf', activityId: extra.endowment, mode: 'amount', amount: 25000 }],
    });
    await approveAll(o5);

    // 6) تبرع لحالة مستفيدة بعينها، ينتظر التدقيق المالي
    await create({
      kind: 'cash', donorId: fahad.id, date: daysAgo(3), totalAmount: 5000, bankAccountId: ahli.id, transferReference: 'SNB-56002',
      lines: [{ targetKind: 'case', beneficiaryRequestId: cases.orphan, mode: 'amount', amount: 5000 }],
    });

    // 7) وعد بالدفع أعاده المدقق المالي لاستكمال المستند
    const o7 = await create({
      kind: 'pledge', donorId: khair.id, supportManagerId: sara.id, date: daysAgo(2), totalAmount: 15000,
      lines: [{ targetKind: 'program', activityId: p.school, mode: 'amount', amount: 15000 }],
    });
    await this.fundraising.decide(finance, o7, { decision: 'return', notes: 'أرفق خطاب الوعد الموقّع من الشركة قبل الاعتماد' });

    // ---------- إدارة الدعم والصرف ----------
    const widowsBatch = await batch(o1, p.widows);
    const ramadanBatch = await batch(o1, p.ramadan);
    const schoolBatch = await batch(o2, p.school);

    // كفالة الأرملة: تحميل 12,000 على دفعة الزكاة، صرف الشهر الأول، وطلب صرف الشهر الثاني بانتظار المالية
    const widowAlloc = await this.support.allocate(pm, { requestId: cases.widow, batchId: widowsBatch.id, amount: 12000, notes: 'كفالة سنوية 12 شهرًا' });
    await this.pay(pm, finance, widowAlloc.id, 1000, 'voucher', 'كفالة الشهر الأول', 'PV-1001', daysAgo(8));
    await this.support.requestPayment(pm, { allocationId: widowAlloc.id, amount: 1000, method: 'voucher', description: 'كفالة الشهر الثاني' });

    // الحقيبة المدرسية: تحميل وصرف بفاتورة مزود الخدمة
    const schoolAlloc = await this.support.allocate(pm, { requestId: cases.school, batchId: schoolBatch.id, amount: 1500 });
    await this.pay(pm, finance, schoolAlloc.id, 1500, 'invoice', 'حقيبة مدرسية ومصروفات دراسية لثلاثة أطفال', 'INV-2026-114', daysAgo(6), 'مكتبة المعرفة للأدوات المدرسية');

    // الصرف العام: حملة التوعية (تبرع عيني) وتشغيل المقر (من المحصّل من الوعد فقط)
    const awarenessAlloc = await this.support.generalDisbursement(pm, { activityId: extra.awareness, batchId: (await batch(o4)).id, notes: 'تجهيز فعالية الفحص المجاني' });
    await this.support.direct(finance, {
      allocationId: awarenessAlloc.id, amount: 5000, method: 'invoice', payeeKind: 'provider', payeeName: 'مؤسسة الفعاليات الصحية',
      description: 'تنفيذ فعالية الفحص المجاني في حي النسيم', referenceNo: 'INV-2026-131', paidOn: daysAgo(5),
    });
    const opsAlloc = await this.support.generalDisbursement(pm, { activityId: extra.operations, batchId: (await batch(o3)).id, notes: 'مصاريف تشغيل الربع الحالي' });
    await this.support.direct(finance, {
      allocationId: opsAlloc.id, amount: 8000, method: 'voucher', payeeKind: 'other', payeeName: 'مالك مبنى المقر',
      description: 'إيجار المقر لثلاثة أشهر', referenceNo: 'PV-1002', paidOn: daysAgo(4),
    });

    // مناقلة: فائض سلة رمضان إلى كفالة الأيتام لنفس الداعم وبنفس الاشتراطات
    await this.transfers.transfer(pm, {
      sourceBatchId: ramadanBatch.id, targetActivityId: p.orphans, amount: 4000,
      reason: 'فائض موسم رمضان يُوجَّه لكفالة الأيتام بعد موافقة الداعم هاتفيًا',
    });

    // تعديل فرصة تبرع بقيد عكسي: الداعم وجّه جزءًا من تبرعه للأيتام ومدّ مدة المشروع
    await this.transfers.amend(pm, {
      batchId: schoolBatch.id, amount: 5000, effectiveDate: daysAgo(1), newActivityId: p.orphans, endDate: daysAhead(365),
      reason: 'طلب الداعم توجيه 5,000 ريال من دعم الحقيبة المدرسية إلى كفالة الأيتام',
      donorApproved: true, donorApprovalRef: 'خطاب الداعم المؤرخ ' + daysAgo(2), acknowledged: true,
    });
  }

  /** طلب صرف من مدير المشاريع ثم تنفيذه من المالية */
  private async pay(
    pm: OrgUser, finance: OrgUser, allocationId: string, amount: number, method: 'voucher' | 'invoice', description: string,
    referenceNo: string, paidOn: string, payeeName?: string,
  ) {
    const pr = await this.support.requestPayment(pm, {
      allocationId, amount, method, description, ...(payeeName ? { payeeKind: 'provider' as const, payeeName } : {}),
    });
    await this.support.execute(finance, pr.id, { referenceNo, paidOn });
  }
}
