import { Injectable } from '@nestjs/common';
import { ChangeService } from '../risk/change.service';
import { ComplianceService } from '../risk/compliance.service';
import { ContinuityService } from '../risk/continuity.service';
import { RegisterService } from '../risk/register.service';
import { RiskCore } from '../risk/risk-core.service';
import { defaultPolicy } from '../risk/risk-defaults';
import { RISK_PERMISSIONS } from '../risk/risk.manifest';
import { RiskDto } from '../risk/risk.dto';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

type Decide = (decision: 'approve') => Promise<{ status: string }>;

/**
 * المخاطر والتغيير والالتزام في الشركة التجريبية: السياسة بإصدارين، سجل المنهجيات، سجل مخاطر متنوع
 * (داخلية وخارجية ومنتجات) بمراجعات دورية خلال سنة، تحليل PESTEL وSWOT، ضوابط، طلبات تغيير بمهام متابعة
 * على الجهات، التزامات وتقييمات، تحليل أثر توقف وخطط تعافي، فريق أزمة معتمد وأزمة منتهية وأخرى مفعّلة،
 * وإجراءات موثقة. كل العمليات عبر خدمات الوحدة نفسها (بنفس التحقق والترقيم والاعتماد).
 */
@Injectable()
export class RiskSeed {
  constructor(
    private readonly core: RiskCore,
    private readonly register: RegisterService,
    private readonly changes: ChangeService,
    private readonly compliance: ComplianceService,
    private readonly continuity: ContinuityService,
  ) {}

  /** يمر بكل مراحل الاعتماد المضبوطة في الإعدادات حتى يُعتمد */
  private async approveAll(decide: Decide) {
    for (let i = 0; i < 7; i++) if ((await decide('approve')).status === 'approved') return;
  }

  async run(team: DemoTeam) {
    const { admin, finance, projectsManager, caseManager, fundraiser, quality } = team;
    const year = Number(daysAgo(0).slice(0, 4));
    const lk = await this.core.lookups(admin);
    const unit = (name: string) => (lk.units as { id: string; name: string }[]).find((u) => u.name === name)?.id ?? null;

    // ---- السياسة: الإصدار الأول بداية السنة، والثاني بتعديل حد القابلية
    const sections = defaultPolicy();
    await this.core.savePolicy(admin, { sections, effectiveDate: `${year}-01-01`, note: 'اعتماد مجلس الإدارة لسياسة المخاطر (قرار 3/1)', approvedBy: 'مجلس الإدارة' });
    const appetite = sections.find((s) => s.key === 'appetite');
    if (appetite) appetite.body += '\nلا تقبل الشركة أي خطر متبقٍ بدرجة 15 فأعلى في حماية المستفيدين أو الالتزام النظامي مهما كانت كلفة المعالجة.';
    await this.core.savePolicy(admin, { sections, effectiveDate: daysAgo(45), note: 'تشديد حد القابلية لمخاطر حماية المستفيدين والالتزام (قرار المجلس 7/2)', approvedBy: 'مجلس الإدارة' });

    // ---- سجل المنهجيات: المقترحة كإصدار أول، ثم إصدار ثانٍ لمنهجية المخاطر
    const m = await this.core.installMethodologies(admin, `${year}-01-01`);
    const rsk = m.items.find((x) => x.code === 'MTH-RSK');
    if (rsk?.current) {
      await this.core.newMethodologyVersion(admin, rsk.id, {
        body: `${rsk.current.body}\n\nإضافة (الإصدار 2): تُراجع المخاطر الحرجة كل أسبوعين بحضور مالك الخطر، ويُرفع ملخصها للجنة المراجعة في كل اجتماع.`,
        effectiveDate: daysAgo(30), approvedBy: 'لجنة المخاطر', note: 'تقصير دورة مراجعة المخاطر الحرجة',
      });
    }
    await this.core.guide(admin);

    // ---- سجل المخاطر
    const R = (over: Partial<RiskDto> & Pick<RiskDto, 'title' | 'source' | 'category'>): RiskDto => ({
      inherentLikelihood: 3, inherentImpact: 3, residualLikelihood: 2, residualImpact: 3, treatment: 'reduce', actions: [], kris: [], ...over,
    } as RiskDto);
    const risks: Record<string, string> = {};
    const add = async (k: string, dto: RiskDto, approve = true) => {
      const r = await this.register.createRisk(admin, dto);
      risks[k] = r.id;
      if (approve) {
        await this.register.submitRisk(admin, r.id);
        await this.approveAll((d) => this.register.decideRisk(admin, r.id, d));
      }
      return r.id;
    };
    await add('donations', R({
      title: 'انخفاض التبرعات عن المستهدف السنوي', source: 'external', category: 'financial', unitId: unit('إدارة تنمية الموارد'), ownerName: fundraiser.fullName,
      description: 'تراجع التحصيل الشهري بسبب الظروف الاقتصادية والاعتماد على حملات موسمية.', causes: 'تركز التبرعات في رمضان، ضعف التبرع الدوري', consequences: 'تأجيل برامج الكفالة والعلاج',
      inherentLikelihood: 4, inherentImpact: 5, residualLikelihood: 4, residualImpact: 4, targetScore: 8, identifiedDate: daysAgo(320),
      actions: [
        { title: 'إطلاق برنامج الاستقطاع الشهري', ownerName: fundraiser.fullName, dueDate: daysAgo(20), status: 'in_progress' },
        { title: 'خطة تنويع المانحين المؤسسيين', ownerName: fundraiser.fullName, dueDate: daysAhead(40), status: 'planned' },
      ],
      kris: [{ name: 'نسبة التحصيل الشهري من المستهدف', threshold: 'أقل من 80%', current: '74%', breached: true }],
    }));
    await add('eligibility', R({
      title: 'صرف الدعم لغير المستحقين', source: 'product', productName: 'برنامج المساعدات الشهرية', category: 'service', unitId: unit('قسم البحث الاجتماعي'), ownerName: caseManager.fullName,
      causes: 'ضعف التحقق من البيانات، تكرار الطلبات بين الجمعيات', inherentLikelihood: 4, inherentImpact: 4, residualLikelihood: 2, residualImpact: 3, identifiedDate: daysAgo(300),
      actions: [{ title: 'الربط مع منصة إحسان للتحقق من التكرار', ownerName: caseManager.fullName, dueDate: daysAgo(60), status: 'done' }],
      kris: [{ name: 'نسبة الحالات المستبعدة بعد المراجعة', threshold: 'أكثر من 5%', current: '2%', breached: false }],
    }));
    await add('safeguarding', R({
      title: 'إيذاء المستفيدين من الأطفال أثناء البرامج', source: 'product', productName: 'برنامج رعاية الأيتام', category: 'safeguarding', unitId: unit('إدارة البرامج والخدمات'), ownerName: projectsManager.fullName,
      inherentLikelihood: 2, inherentImpact: 5, residualLikelihood: 1, residualImpact: 5, treatment: 'reduce', identifiedDate: daysAgo(280),
      actions: [{ title: 'تدريب كل المتطوعين على سياسة الحماية', ownerName: projectsManager.fullName, dueDate: daysAhead(25), status: 'in_progress' }],
    }));
    await add('data', R({
      title: 'تسرب بيانات المستفيدين والمانحين', source: 'internal', category: 'technology', unitId: unit('إدارة الشؤون المالية والإدارية'), ownerName: admin.fullName,
      inherentLikelihood: 3, inherentImpact: 5, residualLikelihood: 2, residualImpact: 4, identifiedDate: daysAgo(250),
      actions: [{ title: 'تفعيل التحقق الثنائي لكل الحسابات', ownerName: admin.fullName, dueDate: daysAgo(10), status: 'planned' }],
      kris: [{ name: 'محاولات الدخول الفاشلة أسبوعيًا', threshold: 'أكثر من 50', current: '18', breached: false }],
    }));
    await add('systems', R({
      title: 'توقف الأنظمة التقنية أو فقد البيانات', source: 'internal', category: 'technology', ownerName: admin.fullName,
      inherentLikelihood: 3, inherentImpact: 4, residualLikelihood: 2, residualImpact: 3, treatment: 'transfer', treatmentNote: 'استضافة سحابية بعقد مستوى خدمة ونسخ احتياطي يومي', identifiedDate: daysAgo(240),
    }));
    await add('governance', R({
      title: 'عدم الالتزام بمتطلبات الحوكمة للجمعيات', source: 'external', category: 'compliance', unitId: unit('قسم الجودة'), ownerName: quality.fullName,
      inherentLikelihood: 3, inherentImpact: 4, residualLikelihood: 2, residualImpact: 4, identifiedDate: daysAgo(200),
    }));
    await add('fraud', R({
      title: 'الاحتيال أو اختلاس في الصرف النقدي', source: 'internal', category: 'fraud', unitId: unit('إدارة الشؤون المالية والإدارية'), ownerName: finance.fullName,
      inherentLikelihood: 2, inherentImpact: 5, residualLikelihood: 1, residualImpact: 4, identifiedDate: daysAgo(190),
    }));
    await add('staff', R({
      title: 'تسرب الكفاءات الرئيسية', source: 'internal', category: 'people', unitId: unit('قسم الموارد البشرية'), ownerName: admin.fullName,
      inherentLikelihood: 3, inherentImpact: 3, residualLikelihood: 3, residualImpact: 3, treatment: 'accept', treatmentNote: 'ضمن حد القابلية، ويعالج بخطة الصف الثاني', identifiedDate: daysAgo(150),
    }));
    await add('flood', R({
      title: 'تضرر مستودع السلال الغذائية بالأمطار والسيول', source: 'external', category: 'environment', unitId: unit('قسم المشاريع'), ownerName: projectsManager.fullName,
      inherentLikelihood: 2, inherentImpact: 4, residualLikelihood: 2, residualImpact: 3, identifiedDate: daysAgo(120),
    }));
    // خطر جديد بانتظار الاعتماد ليظهر في «بانتظار اعتمادي»
    const pending = await add('reputation', R({
      title: 'انتشار شكوى مستفيد على وسائل التواصل', source: 'external', category: 'reputation', ownerName: admin.fullName,
      inherentLikelihood: 3, inherentImpact: 4, residualLikelihood: 2, residualImpact: 4, identifiedDate: daysAgo(5),
    }), false);
    await this.register.submitRisk(admin, pending);

    // مراجعات دورية خلال السنة لتظهر في اتجاه المخاطر
    const reviews: [string, number, number, number, string][] = [
      ['donations', 260, 4, 5, 'التحصيل أقل من المستهدف بنسبة 30%'], ['donations', 180, 4, 5, 'استمرار التراجع'], ['donations', 90, 4, 4, 'بدء الاستقطاع الشهري'], ['donations', 15, 4, 4, 'تحسن طفيف'],
      ['eligibility', 220, 3, 4, 'بدء التحقق الميداني'], ['eligibility', 120, 2, 4, 'الربط مع منصة التحقق'], ['eligibility', 30, 2, 3, 'انخفاض الحالات المستبعدة'],
      ['data', 200, 3, 4, 'مراجعة الصلاحيات'], ['data', 100, 2, 4, 'تشفير النسخ الاحتياطية'],
      ['systems', 160, 2, 4, 'نقل الاستضافة للسحابة'], ['systems', 40, 2, 3, 'نجاح اختبار الاستعادة'],
      ['governance', 140, 3, 4, 'ملاحظات المركز الوطني'], ['governance', 50, 2, 4, 'استكمال اللوائح'],
    ];
    for (const [k, ago, l, i, note] of reviews) await this.register.reviewRisk(admin, risks[k], { reviewDate: daysAgo(ago), likelihood: l, impact: i, note });

    // ---- الضوابط
    const ctl = async (dto: Parameters<RegisterService['saveControl']>[1]) => (await this.register.saveControl(admin, dto)).id as string;
    const bankRec = await ctl({ name: 'تسوية بنكية شهرية يراجعها شخص مستقل', type: 'detective', automated: false, frequency: 'monthly', ownerName: finance.fullName, effectiveness: 'effective', lastTestDate: daysAgo(25), riskIds: [risks.fraud] });
    const dual = await ctl({ name: 'اعتماد ثنائي لكل سند صرف', type: 'preventive', automated: true, frequency: 'continuous', ownerName: finance.fullName, effectiveness: 'effective', lastTestDate: daysAgo(70), riskIds: [risks.fraud, risks.eligibility] });
    const research = await ctl({ name: 'بحث ميداني وتحقق آلي من تكرار الطلبات', type: 'preventive', automated: false, frequency: 'continuous', ownerName: caseManager.fullName, effectiveness: 'partial', lastTestDate: daysAgo(120), riskIds: [risks.eligibility] });
    const backup = await ctl({ name: 'نسخ احتياطي يومي واختبار استعادة ربع سنوي', type: 'corrective', automated: true, frequency: 'quarterly', ownerName: admin.fullName, effectiveness: 'effective', lastTestDate: daysAgo(40), riskIds: [risks.systems, risks.data] });
    await ctl({ name: 'سياسة حماية المستفيدين والتحقق المسبق من المتطوعين', type: 'directive', automated: false, frequency: 'annual', ownerName: projectsManager.fullName, effectiveness: 'not_tested', riskIds: [risks.safeguarding] });
    await ctl({ name: 'تقرير تحصيل أسبوعي مقارن بالمستهدف', type: 'detective', automated: true, frequency: 'monthly', ownerName: fundraiser.fullName, effectiveness: 'partial', lastTestDate: daysAgo(400), riskIds: [risks.donations] });

    // ---- تحليل PESTEL وSWOT، وتحويل عامل إلى خطر في السجل
    const pestel = await this.register.createAnalysis(admin, {
      kind: 'pestel', title: `تحليل البيئة الخارجية ${year}`, scope: 'الشركة كاملة', analysisDate: daysAgo(100), summary: 'أبرز المؤثرات: اشتراطات الحوكمة، والوضع الاقتصادي، والتحول الرقمي في التبرع.',
      items: [
        { factor: 'political', text: 'توجه الدولة لتمكين القطاع غير الربحي ضمن رؤية 2030', impact: 3, likelihood: 4 },
        { factor: 'economic', text: 'ارتفاع تكاليف المعيشة وزيادة الطلب على المساعدات', impact: 4, likelihood: 4 },
        { factor: 'social', text: 'ارتفاع وعي المانحين بأثر البرامج وطلبهم للتقارير', impact: 3, likelihood: 4 },
        { factor: 'technological', text: 'انتشار منصات التبرع الإلكتروني والمحافظ الرقمية', impact: 3, likelihood: 5 },
        { factor: 'environmental', text: 'السيول الموسمية في المنطقة', impact: 4, likelihood: 2 },
        { factor: 'legal', text: 'تحديث نظام حماية البيانات الشخصية ولوائحه', impact: 4, likelihood: 3 },
      ],
    });
    const legal = pestel.items.find((x: { factor: string }) => x.factor === 'legal');
    if (legal) await this.register.itemToRisk(admin, pestel.id, { itemId: legal.id, category: 'compliance', ownerName: quality.fullName });
    await this.register.submitAnalysis(admin, pestel.id);
    await this.approveAll((d) => this.register.decideAnalysis(admin, pestel.id, d));
    const swot = await this.register.createAnalysis(admin, {
      kind: 'swot', title: 'التحليل الرباعي للخطة الاستراتيجية', analysisDate: daysAgo(80),
      items: [
        { factor: 'strength', text: 'سمعة جيدة وثقة المانحين المحليين', impact: 4, likelihood: 5 },
        { factor: 'strength', text: 'قاعدة بيانات مستفيدين محدثة في نظام سنابل', impact: 3, likelihood: 5 },
        { factor: 'weakness', text: 'الاعتماد على حملات رمضان في معظم الإيرادات', impact: 4, likelihood: 4 },
        { factor: 'weakness', text: 'نقص المتطوعين المدربين', impact: 3, likelihood: 3 },
        { factor: 'opportunity', text: 'منح الجهات المانحة للمشاريع التنموية', impact: 4, likelihood: 3 },
        { factor: 'threat', text: 'دخول جمعيات جديدة في نفس النطاق الجغرافي', impact: 3, likelihood: 3 },
      ],
      strategies: [
        { type: 'SO', text: 'استثمار ثقة المانحين في برنامج استقطاع شهري' },
        { type: 'WO', text: 'التقدم لمنح تنموية لتقليل الاعتماد على الحملات الموسمية' },
        { type: 'ST', text: 'إبراز أثر البرامج بتقارير دورية للتميز عن الجمعيات الجديدة' },
        { type: 'WT', text: 'شراكة مع جمعيات قائمة في التدريب والتطوع' },
      ],
    });
    // معتمد: تستند إليه الخطة الاستراتيجية في نظام التخطيط
    await this.register.submitAnalysis(admin, swot.id);
    await this.approveAll((d) => this.register.decideAnalysis(admin, swot.id, d));

    // ---- سجل التغيير ومهامه على الجهات
    const ch1 = await this.changes.createChange(admin, {
      title: 'التحول للصرف الإلكتروني للمساعدات بدل الشيكات', changeType: 'process', changeClass: 'normal', priority: 'high',
      reason: 'تقليل مخاطر الصرف النقدي وتسريع وصول الدعم', benefits: 'وصول الدعم خلال يوم بدل أسبوع، وأثر رقابي كامل', costEstimate: 15000,
      affectedUnits: 'المالية، البحث الاجتماعي', impacts: [{ area: 'العمليات والإجراءات', level: 4 }, { area: 'المستفيدون', level: 3 }, { area: 'الأنظمة والتقنية', level: 3 }],
      riskIds: [risks.fraud, risks.eligibility], plannedStart: daysAgo(40), plannedEnd: daysAhead(30), communication: 'إشعار المستفيدين برسالة نصية وتحديث البوابة',
    });
    await this.changes.submitChange(admin, ch1.id);
    await this.approveAll((d) => this.changes.decideChange(admin, ch1.id, d));
    const task = (title: string, unitName: string, who: { id: string }, start: number, due: number) =>
      this.changes.addTask(admin, 'change', ch1.id, { title, unitId: unit(unitName), assigneeUserId: who.id, startDate: daysAgo(start), dueDate: daysAgo(due) });
    const t1 = await task('تحديث إجراء الصرف واعتماده', 'قسم الجودة', quality, 35, 20);
    const t2 = await task('جمع أرقام الآيبان للمستفيدين والتحقق منها', 'قسم البحث الاجتماعي', caseManager, 30, 5);
    await task('ربط ملف الصرف البنكي بالنظام المالي', 'إدارة الشؤون المالية والإدارية', finance, 20, -20);
    await task('تدريب الباحثين والمحاسبين على الإجراء الجديد', 'قسم الموارد البشرية', admin, 10, -25);
    await this.changes.progressChange(admin, ch1.id, { phase: 'implementing' });
    await this.changes.progressTask(admin, t1.id, { status: 'done', progress: 100, completionNote: 'اعتُمد الإجراء PRC-001 بإصداره الأول' });
    await this.changes.progressTask(admin, t2.id, { status: 'in_progress', progress: 60, completionNote: null });

    const ch2 = await this.changes.createChange(admin, {
      title: 'اعتماد نظام سنابل لإدارة الشركة', changeType: 'technology', changeClass: 'normal', priority: 'medium', reason: 'توحيد الأنظمة وربط البيانات',
      impacts: [{ area: 'الأفراد', level: 3 }, { area: 'الأنظمة والتقنية', level: 4 }], riskIds: [risks.systems], plannedStart: daysAgo(200), plannedEnd: daysAgo(60),
    });
    await this.changes.submitChange(admin, ch2.id);
    await this.approveAll((d) => this.changes.decideChange(admin, ch2.id, d));
    const t3 = await this.changes.addTask(admin, 'change', ch2.id, { title: 'ترحيل بيانات المستفيدين', unitId: unit('قسم البحث الاجتماعي'), assigneeUserId: caseManager.id, dueDate: daysAgo(90) });
    await this.changes.progressChange(admin, ch2.id, { phase: 'implementing' });
    await this.changes.progressTask(admin, t3.id, { status: 'done', progress: 100, completionNote: 'رُحّلت 1,240 حالة' });
    await this.changes.progressChange(admin, ch2.id, { phase: 'completed', reviewResult: 'اكتمل التشغيل وتحققت المنافع المتوقعة' });
    await this.changes.progressChange(admin, ch2.id, { phase: 'closed', lessons: 'التدريب قبل الإطلاق بأسبوعين قلل الأخطاء كثيرًا' });

    const ch3 = await this.changes.createChange(admin, {
      title: 'إعادة هيكلة إدارة تنمية الموارد', changeType: 'structure', changeClass: 'normal', priority: 'medium', reason: 'فصل التبرع الفردي عن الشراكات المؤسسية',
      impacts: [{ area: 'الأفراد', level: 4 }, { area: 'التكلفة والميزانية', level: 2 }], riskIds: [risks.donations],
    });
    await this.changes.submitChange(admin, ch3.id);

    // ---- الالتزام
    const obl = async (dto: Parameters<ComplianceService['saveObligation']>[1]) => (await this.compliance.saveObligation(admin, dto)).id as string;
    const assess = async (id: string, dto: Parameters<ComplianceService['addAssessment']>[2]) => {
      const o = await this.compliance.addAssessment(admin, id, dto);
      const a = o.assessments[0];
      await this.compliance.submitAssessment(admin, a.id);
      await this.approveAll((d) => this.compliance.decideAssessment(admin, a.id, d));
    };
    const o1 = await obl({ title: 'رفع القوائم المالية المدققة', authority: 'المركز الوطني لتنمية القطاع غير الربحي', reference: 'المادة 30 من اللائحة التنفيذية', frequency: 'annual', ownerName: finance.fullName, riskId: risks.governance });
    await assess(o1, { assessmentDate: daysAgo(60), result: 'compliant', evidence: 'إشعار استلام المركز' });
    const o2 = await obl({ title: 'عقد الجمعية العمومية العادية سنويًا', authority: 'نظام الجمعيات والمؤسسات الأهلية ولائحته التنفيذية', frequency: 'annual', ownerName: admin.fullName });
    await assess(o2, { assessmentDate: daysAgo(90), result: 'compliant', evidence: 'محضر الاجتماع' });
    const o3 = await obl({ title: 'إشعار صاحب البيانات بأغراض جمعها', authority: 'نظام حماية البيانات الشخصية', frequency: 'continuous', ownerName: quality.fullName, riskId: risks.data });
    await assess(o3, { assessmentDate: daysAgo(20), result: 'partial', gaps: 'نموذج الطلب في البوابة لا يحتوي إشعار الخصوصية', correctiveAction: 'إضافة إشعار الخصوصية لنموذج التقديم', actionOwner: quality.fullName, actionDueDate: daysAhead(20) });
    const o4 = await obl({ title: 'التحقق من هوية المتبرعين بمبالغ كبيرة', authority: 'نظام مكافحة غسل الأموال وتمويل الإرهاب', frequency: 'continuous', ownerName: fundraiser.fullName });
    await assess(o4, { assessmentDate: daysAgo(45), result: 'non_compliant', gaps: 'لا يوجد حد معتمد للتحقق', correctiveAction: 'اعتماد سياسة اعرف متبرعك', actionOwner: fundraiser.fullName, actionDueDate: daysAgo(5) });
    const o5 = await obl({ title: 'تسجيل الموظفين في التأمينات الاجتماعية', authority: 'المؤسسة العامة للتأمينات الاجتماعية', frequency: 'monthly', ownerName: admin.fullName });
    await assess(o5, { assessmentDate: daysAgo(10), result: 'compliant', evidence: 'كشف اشتراكات الشهر من بوابة التأمينات' });
    await obl({ title: 'تقديم إقرار ضريبة القيمة المضافة', authority: 'هيئة الزكاة والضريبة والجمارك', frequency: 'quarterly', ownerName: finance.fullName, nextDueDate: daysAhead(15) });
    await obl({ title: 'تقرير ربع سنوي للجهة المانحة عن مشروع السلال', authority: 'اشتراطات الجهات المانحة', frequency: 'quarterly', ownerName: projectsManager.fullName, nextDueDate: daysAgo(3) });

    // ---- استمرارية الأعمال: تحليل أثر التوقف وخطط التعافي
    const bia = async (dto: Parameters<ContinuityService['saveContinuity']>[1], approve = true) => {
      const b = await this.continuity.saveContinuity(admin, dto);
      if (approve) {
        await this.continuity.submitContinuity(admin, b.id);
        await this.approveAll((d) => this.continuity.decideContinuity(admin, b.id, d));
      }
      return b.id as string;
    };
    const aid = await bia({
      activity: 'صرف المساعدات الشهرية للأسر', unitName: 'قسم البحث الاجتماعي', ownerName: caseManager.fullName, description: 'صرف الدعم الشهري لأكثر من 400 أسرة',
      impacts: { financial: 3, beneficiaries: 5, reputation: 4, legal: 2, operational: 4 }, mtpdHours: 72, rtoHours: 48, rpoHours: 24,
      minResources: 'محاسب وباحث واحد، وصول للبنك الإلكتروني، قائمة المستفيدين المعتمدة', strategy: 'صرف يدوي بشيكات معتمدة مسبقًا من قائمة آخر شهر',
      dependencies: [{ kind: 'system', name: 'نظام سنابل' }, { kind: 'supplier', name: 'البنك' }, { kind: 'people', name: 'المحاسب المعتمد' }],
      steps: [{ title: 'إعلان تفعيل الخطة وإبلاغ البنك', ownerName: finance.fullName, withinHours: 4 }, { title: 'تصدير آخر قائمة صرف معتمدة', ownerName: caseManager.fullName, withinHours: 12 }, { title: 'الصرف اليدوي واعتماده ثنائيًا', ownerName: finance.fullName, withinHours: 48 }],
      riskIds: [risks.systems], lastTestDate: daysAgo(100), lastTestResult: 'نجح الاختبار المكتبي، واستغرق التصدير 3 ساعات',
    });
    const did = await bia({
      activity: 'استقبال التبرعات الإلكترونية', unitName: 'إدارة تنمية الموارد', ownerName: fundraiser.fullName,
      impacts: { financial: 5, beneficiaries: 2, reputation: 4, legal: 1, operational: 3 }, mtpdHours: 24, rtoHours: 8, rpoHours: 1,
      strategy: 'تحويل الحملات لرابط الدفع الاحتياطي ونشر رقم الحساب البنكي', dependencies: [{ kind: 'system', name: 'بوابة الدفع' }, { kind: 'supplier', name: 'مزود الاستضافة' }],
      steps: [{ title: 'تفعيل رابط الدفع الاحتياطي', ownerName: fundraiser.fullName, withinHours: 2 }, { title: 'إشعار المتبرعين عبر القنوات', ownerName: fundraiser.fullName, withinHours: 4 }],
      riskIds: [risks.systems, risks.donations], lastTestDate: daysAgo(420),
    });
    await bia({
      activity: 'توزيع السلال الغذائية من المستودع', unitName: 'قسم المشاريع', ownerName: projectsManager.fullName,
      impacts: { financial: 2, beneficiaries: 4, reputation: 3, legal: 1, operational: 3 }, mtpdHours: 168, rtoHours: 72,
      dependencies: [{ kind: 'facility', name: 'المستودع الرئيسي' }, { kind: 'supplier', name: 'مورد المواد الغذائية' }],
      steps: [{ title: 'نقل المخزون لمستودع الشريك', ownerName: projectsManager.fullName, withinHours: 48 }], riskIds: [risks.flood],
    }, false);

    // ---- فريق الأزمات: لائحة صلاحيات وصلاحيات نظام تُمنح عند التفعيل
    const team1 = await this.continuity.saveTeam(admin, {
      name: 'فريق إدارة الأزمات والطوارئ', kind: 'crisis', mandate: 'إدارة أي حدث يهدد سلامة المستفيدين أو استمرار الخدمات أو سمعة الشركة حتى العودة للوضع الطبيعي',
      members: [
        { userId: admin.id, name: admin.fullName, teamRole: 'قائد الفريق', phone: '0500000001', alternate: finance.fullName },
        { userId: finance.id, name: finance.fullName, teamRole: 'مسؤول الصرف الطارئ', phone: '0500000002' },
        { userId: caseManager.id, name: caseManager.fullName, teamRole: 'مسؤول المستفيدين', phone: '0500000003' },
        { userId: projectsManager.id, name: projectsManager.fullName, teamRole: 'مسؤول العمليات الميدانية' },
        { userId: null, name: 'المتحدث الرسمي', teamRole: 'الاتصال والإعلام' },
      ],
      authorities: [
        { authority: 'اعتماد صرف طارئ دون انتظار لجنة الصرف', holder: 'قائد الفريق', limit: 'حتى 50,000 ريال لكل حالة' },
        { authority: 'تعليق برنامج أو نشاط مؤقتًا', holder: 'قائد الفريق', limit: 'حتى 14 يومًا' },
        { authority: 'التعاقد المباشر مع مورد بديل', holder: 'مسؤول الصرف الطارئ', limit: 'حتى 20,000 ريال' },
        { authority: 'قبول طلبات الإغاثة العاجلة دون بحث ميداني مسبق', holder: 'مسؤول المستفيدين', limit: 'يُستكمل البحث خلال 7 أيام' },
        { authority: 'التصريح لوسائل الإعلام', holder: 'المتحدث الرسمي', limit: null },
      ],
      systemPermissions: [RISK_PERMISSIONS.compliance, RISK_PERMISSIONS.change],
      playbook: [
        { title: 'تقييم الموقف وتحديد شدة الأزمة', ownerName: 'قائد الفريق', withinHours: 2 },
        { title: 'حصر المستفيدين المتأثرين', ownerName: 'مسؤول المستفيدين', withinHours: 12 },
        { title: 'بيان أولي للمانحين والجمهور', ownerName: 'المتحدث الرسمي', withinHours: 24 },
        { title: 'تفعيل خطط التعافي المرتبطة', ownerName: 'مسؤول الصرف الطارئ', withinHours: 24 },
      ],
      communication: 'مجموعة تواصل للفريق، واجتماع يومي 8 صباحًا خلال الأزمة، وتقرير يومي لرئيس المجلس.',
      continuityIds: [aid, did],
    });
    await this.continuity.submitTeam(admin, team1.id);
    await this.approveAll((d) => this.continuity.decideTeam(admin, team1.id, d));
    // أزمة سابقة انتهت بدروس مستفادة
    const ev1 = await this.continuity.activate(admin, team1.id, { title: 'تعطل بوابة الدفع في حملة رمضان', severity: 'major', scenario: 'توقف بوابة الدفع 9 ساعات في ليلة 27 رمضان', riskId: risks.donations });
    await this.continuity.addLog(admin, ev1.id, { text: 'تفعيل رابط الدفع الاحتياطي ونشره في القنوات' });
    await this.continuity.addLog(finance, ev1.id, { text: 'تأكيد وصول التحويلات البنكية المباشرة' });
    await this.continuity.close(admin, ev1.id, { lessons: 'ربط الحملات برابطين للدفع من البداية، واختبار البوابة قبل المواسم بأسبوع' });
    // أزمة مفعّلة الآن: صلاحيات الطوارئ ممنوحة للأعضاء ومهام الاستجابة قائمة
    const ev2 = await this.continuity.activate(admin, team1.id, {
      title: 'سيول في حي الشرائع وتضرر أسر مستفيدة', severity: 'critical', riskId: risks.flood,
      scenario: 'أمطار غزيرة أدت لتضرر منازل 35 أسرة مسجلة، وتعطل الوصول للمستودع.',
    });
    await this.continuity.addLog(admin, ev2.id, { text: 'اجتماع الفريق الأول وتصنيف الأزمة حرجة' });
    await this.continuity.addLog(caseManager, ev2.id, { text: 'حصر 22 أسرة حتى الآن، وتحويل 6 أسر للإيواء المؤقت' });

    await this.continuity.saveTeam(admin, {
      name: 'فريق التعافي واستعادة الأنظمة', kind: 'recovery', members: [{ userId: null, name: 'مسؤول تقنية المعلومات', teamRole: 'قائد الفريق' }],
      authorities: [{ authority: 'التعاقد مع مزود استضافة بديل', holder: 'قائد الفريق', limit: 'حتى 10,000 ريال' }], systemPermissions: [],
      playbook: [{ title: 'استعادة آخر نسخة احتياطية', ownerName: 'قائد الفريق', withinHours: 8 }], continuityIds: [did],
    });

    // ---- هندسة الإجراءات
    const p1 = await this.changes.createProcedure(admin, {
      name: 'إجراء صرف المساعدات إلكترونيًا', domain: 'risk', ownerName: finance.fullName,
      purpose: 'ضمان وصول الدعم للمستحق بالمبلغ المعتمد وبأثر رقابي كامل', scope: 'كل المساعدات النقدية الدورية والطارئة',
      inputs: 'قرار الاستحقاق المعتمد، رقم الآيبان الموثق', outputs: 'ملف تحويل بنكي، قيد محاسبي، إشعار للمستفيد',
      steps: [
        { title: 'إعداد كشف الصرف من الحالات المعتمدة', actor: 'الباحث الاجتماعي', durationDays: 1, output: 'كشف الصرف', control: null, description: null, decision: false },
        { title: 'مطابقة الكشف مع قرارات الاستحقاق', actor: 'مدير الحالات', durationDays: 1, output: null, control: 'مراجعة 10% عينة عشوائية', description: null, decision: true },
        { title: 'إنشاء ملف التحويل البنكي', actor: 'المحاسب', durationDays: 1, output: 'ملف التحويل', control: null, description: null, decision: false },
        { title: 'الاعتماد الثنائي في البنك', actor: 'المدير المالي والمدير التنفيذي', durationDays: 1, output: null, control: 'اعتماد ثنائي', description: null, decision: true },
        { title: 'إشعار المستفيدين وتسجيل القيد', actor: 'المحاسب', durationDays: 1, output: 'قيد الصرف', control: 'تسوية بنكية شهرية', description: null, decision: false },
      ],
      kpis: [{ name: 'متوسط مدة الصرف من الاعتماد', target: '3 أيام' }, { name: 'نسبة الصرف الخاطئ', target: '0%' }],
      riskIds: [risks.fraud, risks.eligibility], controlIds: [bankRec, dual, research],
    });
    await this.changes.submitProcedure(admin, p1.id);
    await this.approveAll((d) => this.changes.decideProcedure(admin, p1.id, d));
    await this.changes.createProcedure(admin, {
      name: 'إجراء النسخ الاحتياطي واختبار الاستعادة', domain: 'continuity', ownerName: admin.fullName,
      steps: [
        { title: 'التحقق اليومي من نجاح النسخ الاحتياطي', actor: 'مسؤول التقنية', durationDays: null, output: 'سجل النسخ', control: 'تنبيه آلي عند الفشل', description: null, decision: false },
        { title: 'اختبار استعادة ربع سنوي', actor: 'مسؤول التقنية', durationDays: 1, output: 'تقرير الاختبار', control: null, description: null, decision: false },
        { title: 'مراجعة نتيجة الاختبار', actor: 'مسؤول المخاطر', durationDays: 1, output: null, control: null, description: null, decision: true },
      ],
      kpis: [{ name: 'نسبة نجاح النسخ', target: '100%' }], riskIds: [risks.systems], controlIds: [backup],
    });
  }
}
