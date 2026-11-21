import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PtContractsService } from '../partnerships/contracts.service';
import { PARTNERSHIP_PERMISSIONS as PT } from '../partnerships/partnerships.manifest';
import { PartnershipsService } from '../partnerships/partnerships.service';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/**
 * الشراكات في الشركة التجريبية: شركاء بمراحل مختلفة (محتمل، قيد التقييم، بانتظار الاعتماد، معتمد، غير مقبول)،
 * وعقود في كل حالة (مسودة، بانتظار الاعتماد، مرسل للتوقيع، موقّع إلكترونيًا، موقّع ورقيًا، منتهٍ ومجدَّد) مع التزامات ومتابعات.
 * تُنفَّذ عبر خدمات الوحدة نفسها كما لو نفذها الموظفون.
 */
@Injectable()
export class PartnershipsSeed {
  constructor(private readonly db: DataSource, private readonly pt: PartnershipsService, private readonly contracts: PtContractsService) {}

  async run(team: DemoTeam) {
    const admin = team.admin;
    const org = admin.organizationId;
    // مسؤولة تنمية الموارد تدير الشراكات وتقيّم الشركاء وتصوغ العقود، والمدير التنفيذي يعتمد
    const officer: OrgUser = { ...team.fundraiser, permissions: [...team.fundraiser.permissions, PT.read, PT.partners, PT.evaluate, PT.contracts, PT.reports] };
    const lk = await this.pt.lookups(org);
    await this.pt.saveGeneral(admin, {
      alertDays: 60, evaluationMonths: 24, signerName: admin.fullName, signerTitle: 'المدير التنفيذي', orgCity: 'الرياض', orgLicense: '1234', courtCity: 'الرياض',
    });
    const type = (name: string) => lk.types.find((t) => t.name === name)!.id;
    const cls = (name: string) => lk.classes.find((c) => c.name.startsWith(name))!.id;
    const donor = async (name: string) => ((await this.db.query('SELECT id FROM fundraising_donors WHERE organization_id = $1 AND name = $2', [org, name]))[0]?.id ?? null) as string | null;
    const project = async (name: string) => ((await this.db.query('SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 AND a.name = $2', [org, name]))[0]?.id ?? null) as string | null;
    const criteria = lk.criteria.filter((c) => c.isActive);
    const scores = (s: number[]) => criteria.map((c, i) => ({ criterionId: c.id, score: s[i] ?? 3, note: null }));

    const partner = (dto: Record<string, unknown>) => this.pt.createPartner(officer, {
      typeIds: [], showOnWebsite: false, classId: null, registrationNo: null, city: 'الرياض', website: null, contactName: null, contactTitle: null, phone: null, email: null, about: null, donorId: null,
      ...dto,
    } as never);
    const evaluate = async (p: { id: string }, typeId: string, s: number[], recommendation: string, submit = true) =>
      this.pt.saveEvaluation(officer, p.id, { typeId, scores: scores(s), recommendation, submit });
    const approve = async (p: { id: string }, typeId: string, s: number[], recommendation: string, note: string | null = null) => {
      const e = await evaluate(p, typeId, s, recommendation);
      await this.pt.decideEvaluation(admin, e.id, { decision: 'approve', note });
    };

    // ---------- الشركاء ----------
    const khair = await partner({
      name: 'شركة الخير القابضة', classId: cls('قطاع خاص'), typeIds: [type('شراكة تمويلية'), type('شراكة استراتيجية')], registrationNo: '1010123456',
      website: 'https://alkhair-holding.sa', contactName: 'م. فهد العتيبي', contactTitle: 'مدير المسؤولية الاجتماعية', phone: '0112223344', email: 'csr@alkhair-holding.sa',
      about: 'شركة قابضة تدعم برامج الأيتام والأرامل من برنامج المسؤولية الاجتماعية منذ 2018م.', donorId: await donor('شركة الخير القابضة'), showOnWebsite: true,
    });
    await approve(khair, type('شراكة تمويلية'), [5, 5, 5, 4, 5, 4, 5], 'شريك موثوق بتجربة تعاون ممتدة ودعم منتظم، يوصى باعتماده شريكًا استراتيجيًا.');

    const birr = await partner({
      name: 'مؤسسة البر الوقفية', classId: cls('مؤسسة مانحة'), typeIds: [type('شراكة تمويلية')], registrationNo: '7001234567', city: 'مكة المكرمة',
      website: 'https://albirr.org.sa', contactName: 'أ. عبدالعزيز المالكي', contactTitle: 'مدير المنح', phone: '0126667788', email: 'grants@albirr.org.sa',
      about: 'مؤسسة وقفية مانحة تمول مشاريع الإسكان والترميم في المنطقة الوسطى والغربية.', donorId: await donor('مؤسسة البر الوقفية'), showOnWebsite: true,
    });
    await approve(birr, type('شراكة تمويلية'), [4, 5, 4, 4, 4, 4, 3], 'مانح مؤسسي بإجراءات منح واضحة، يناسب مشاريع الإسكان.');

    const uni = await partner({
      name: 'كلية الخدمة الاجتماعية بجامعة الرياض الأهلية', classId: cls('جهة أكاديمية'), typeIds: [type('شراكة معرفية وفنية')], registrationNo: 'EDU-4410',
      website: 'https://ruc.edu.sa', contactName: 'د. نورة السبيعي', contactTitle: 'وكيلة الكلية للشراكات', phone: '0114556677', email: 'partnerships@ruc.edu.sa',
      about: 'تقدم برامج تدريب ميداني للطلاب وبحوثًا تطبيقية في قياس الأثر الاجتماعي.', showOnWebsite: true,
    });
    await approve(uni, type('شراكة معرفية وفنية'), [5, 5, 3, 5, 4, 4, 3], 'خبرة بحثية عالية في دراسات الحالة وقياس الأثر، ويستفيد طلابها من التدريب الميداني.');

    const daman = await partner({
      name: 'مكتب الضمان الاجتماعي بالرياض', classId: cls('جهة حكومية'), typeIds: [type('شراكة تنفيذية')], registrationNo: null,
      contactName: 'أ. سعد الحربي', contactTitle: 'مدير المكتب', phone: '0119990000', email: 'riyadh@daman.gov.sa',
      about: 'تبادل الإحالات للأسر المستحقة وتنسيق الزيارات الميدانية المشتركة.',
    });
    await approve(daman, type('شراكة تنفيذية'), [4, 5, 4, 3, 4, 4, 3], 'شراكة إحالة وتنسيق تقلل ازدواج الصرف وتسرّع وصول الأسر للخدمة.');

    const athar = await partner({
      name: 'منصة أثر الإعلامية', classId: cls('جهة إعلامية'), typeIds: [type('شراكة إعلامية')], registrationNo: '1010778899',
      website: 'https://athar.media', contactName: 'أ. ريم الزهراني', contactTitle: 'مديرة الشراكات', phone: '0501112233', email: 'partners@athar.media',
      about: 'منصة إعلامية رقمية متخصصة في المحتوى المجتمعي وقصص الأثر.',
    });
    await evaluate(athar, type('شراكة إعلامية'), [4, 4, 3, 3, 3, 3, 3], 'منصة بانتشار جيد بين الشباب، ويحتاج التعاون لاتفاق واضح على خصوصية صور المستفيدين.');

    const kharj = await partner({
      name: 'جمعية رعاية الأسرة بالخرج', classId: cls('جمعية'), typeIds: [type('شراكة تنفيذية')], registrationNo: '2245', city: 'الخرج',
      contactName: 'أ. منيرة القحطاني', contactTitle: 'المديرة التنفيذية', phone: '0115443322', email: 'info@family-kharj.org.sa',
      about: 'جمعية نظيرة تعمل في الخرج، ومرشحة لتنفيذ برنامج التمكين الاقتصادي في المحافظة.',
    });
    await this.pt.saveEvaluation(officer, kharj.id, { typeId: type('شراكة تنفيذية'), scores: scores([5, 4, 3]).slice(0, 3), recommendation: null, submit: false });

    const nama = await partner({
      name: 'شركة نماء للتقنية', classId: cls('قطاع خاص'), typeIds: [type('شراكة معرفية وفنية')], registrationNo: '1010665544',
      contactName: 'م. ماجد الشمري', contactTitle: 'الرئيس التنفيذي', phone: '0556667788', email: 'info@namaa-tech.sa',
      about: 'عرضت تطوير تطبيق للتبرعات مقابل نسبة من التبرعات المحصلة.',
    });
    const ne = await evaluate(nama, type('شراكة معرفية وفنية'), [3, 1, 4, 4, 3, 2, 3], 'العرض مشروط بنسبة من التبرعات، وعليها ملاحظات تعاقدية سابقة مع جهات أخرى.');
    await this.pt.decideEvaluation(admin, ne.id, { decision: 'reject', note: 'لم تجتز معيار السمعة والنزاهة، ونموذج النسبة من التبرعات لا يتوافق مع سياسة الشركة.' });

    await partner({
      name: 'مجمع الرعاية الطبية الأهلي', classId: cls('قطاع خاص'), typeIds: [type('شراكة مجتمعية وتطوعية')], contactName: 'د. هشام الغامدي', contactTitle: 'مدير العلاقات العامة',
      phone: '0114441122', email: 'pr@care-medical.sa', about: 'تواصل معنا عبر نموذج الموقع لتقديم أيام طبية مجانية للأسر.',
    });

    // ---------- العقود ----------
    const terms = { orgSignerName: admin.fullName, orgSignerTitle: 'المدير التنفيذي' };
    const token = async (id: string) => ((await this.db.query('SELECT token FROM pt_contracts WHERE id = $1', [id]))[0].token) as string;
    const toSign = async (c: { id: string }) => {
      await this.contracts.submit(officer, c.id);
      await this.contracts.decide(admin, c.id, 'approve', 'البنود مطابقة للمكتبة المعتمدة');
      await this.contracts.send(officer, c.id);
    };
    const followup = (c: { id: string }, title: string, kind: string, party: 'org' | 'partner', dueDate: string, responsible: string) =>
      this.pt.addFollowup(officer, c.id, { title, kind, party, dueDate, responsible, note: null });

    // شركة الخير: عقد سابق منتهٍ ثم تجديده الساري
    const orphans = await project('كفالة الأيتام');
    const old = await this.contracts.create(officer, {
      partnerId: khair.id, typeId: type('شراكة تمويلية'), title: 'دعم برنامج كفالة الأيتام 2025', startsOn: daysAgo(500), endsOn: daysAgo(136), value: 350000, projectId: orphans, ...terms,
    });
    await toSign(old);
    await this.contracts.sign(await token(old.id), { signerName: 'م. فهد العتيبي', signerTitle: 'مدير المسؤولية الاجتماعية', registrationNo: '1010123456', agree: true }, '10.0.0.8');
    const renewed = await this.contracts.renew(officer, old.id);
    await this.contracts.update(officer, renewed.id, {
      terms: { title: 'دعم برنامج كفالة الأيتام 2026', startsOn: daysAgo(135), endsOn: daysAhead(230), value: 500000, projectId: orphans, ...terms },
    });
    await toSign(renewed);
    await this.contracts.sign(await token(renewed.id), { signerName: 'م. فهد العتيبي', signerTitle: 'مدير المسؤولية الاجتماعية', registrationNo: '1010123456', agree: true }, '10.0.0.8');
    await followup(renewed, 'استلام الدفعة الأولى (250,000 ريال)', 'payment', 'partner', daysAgo(120), 'م. فهد العتيبي');
    await followup(renewed, 'التقرير الربعي الأول عن الأيتام المكفولين', 'report', 'org', daysAgo(45), officer.fullName);
    await followup(renewed, 'التقرير الربعي الثاني', 'report', 'org', daysAgo(5), officer.fullName);
    await followup(renewed, 'اجتماع مراجعة أداء الشراكة نصف السنوي', 'review', 'org', daysAhead(20), admin.fullName);
    await followup(renewed, 'استلام الدفعة الثانية (250,000 ريال)', 'payment', 'partner', daysAhead(45), 'م. فهد العتيبي');
    const fus = await this.pt.followups(officer, { contract: renewed.id });
    for (const f of fus.filter((x) => x.dueDate < daysAgo(30))) await this.pt.doneFollowup(officer, f.id, { done: true, note: 'أُنجز في موعده' });

    // مؤسسة البر: عقد موقّع ورقيًا ينتهي خلال 40 يومًا (يظهر في التنبيهات)
    const housing = await project('ترميم منازل الأسر المتعففة');
    const birrC = await this.contracts.create(officer, {
      partnerId: birr.id, typeId: type('شراكة تمويلية'), title: 'منحة ترميم منازل الأسر المتعففة', startsOn: daysAgo(325), endsOn: daysAhead(40), value: 180000, projectId: housing, ...terms,
    });
    await this.contracts.submit(officer, birrC.id);
    await this.contracts.decide(admin, birrC.id, 'approve', null);
    await this.contracts.manualSign(admin, birrC.id, { signerName: 'أ. عبدالعزيز المالكي', signerTitle: 'مدير المنح', signedOn: daysAgo(326) });
    await followup(birrC, 'التقرير المالي الختامي للمنحة', 'report', 'org', daysAhead(70), team.finance.fullName);
    await followup(birrC, 'صور ومؤشرات المنازل المرممة', 'obligation', 'org', daysAgo(10), team.projectsManager.fullName);

    // الجامعة: مرسل للتوقيع بعد طلب تعديل (إصداران)
    const uniC = await this.contracts.create(officer, {
      partnerId: uni.id, typeId: type('شراكة معرفية وفنية'), title: 'التدريب الميداني وقياس أثر برامج التمكين', startsOn: daysAhead(10), endsOn: daysAhead(740), value: null, projectId: null, ...terms,
    });
    await toSign(uniC);
    await this.contracts.requestChanges(await token(uniC.id), 'نرجو إضافة بند يحدد عدد الطلاب المتدربين في كل فصل دراسي (10 طلاب) وآلية الإشراف المشترك.');
    const detail = await this.contracts.get(officer, uniC.id);
    await this.contracts.update(officer, uniC.id, {
      items: [...detail.items, {
        key: 'demo-training', clauseId: null, categoryId: 'duties', categoryName: '', mandatory: false, title: 'التدريب الميداني للطلاب',
        paragraphs: ['تستقبل الشركة عشرة طلاب متدربين في كل فصل دراسي، ويشرف عليهم مشرف من الكلية ومشرف من الشركة.', 'تُقيَّم مخرجات التدريب بنموذج تقييم مشترك يعتمده الطرفان.'],
      }],
    });
    await toSign(uniC);

    // الضمان الاجتماعي: بانتظار الاعتماد الداخلي (يظهر في جرس المدير)
    const damanC = await this.contracts.create(officer, {
      partnerId: daman.id, typeId: type('شراكة تنفيذية'), title: 'تبادل الإحالات والزيارات الميدانية المشتركة', startsOn: daysAhead(15), endsOn: daysAhead(380), value: null, projectId: null, ...terms,
    });
    const nf = (await this.pt.clauses(org)).find((c) => c.title === 'عدم وجود التزامات مالية');
    if (nf) await this.contracts.addClause(officer, damanC.id, nf.id);
    await this.contracts.submit(officer, damanC.id);

    // مسودة تجديد مع مؤسسة البر قيد الإعداد
    await this.contracts.renew(officer, birrC.id);
  }
}
