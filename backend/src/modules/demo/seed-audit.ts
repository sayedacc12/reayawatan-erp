import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role, User } from '../../core/entities';
import { ActionsService } from '../audit/actions.service';
import { AuditCore, RegisterRisk, today } from '../audit/audit-core.service';
import { AUDIT_PERMISSIONS as P } from '../audit/audit.manifest';
import { EngagementService } from '../audit/engagement.service';
import { AuditAction, AuditEngagement, RiskRef } from '../audit/entities/audit.entity';
import { PlanningService } from '../audit/planning.service';
import { DemoTeam, actorOf, daysAgo, daysAhead } from './demo-context';

/**
 * المراجعة الداخلية في الشركة التجريبية: مجالات المراجعة بتقييم مخاطرها، خطة رئيسية معتمدة وخطط فرعية
 * (على إدارات من الهيكل وعلى الشركاء المنفذين خارجه)، مهام في كل المراحل، وتوصيات تحولت لمهام متابعة:
 * مغلقة بتقرير إغلاق، وبانتظار التحقق، وقيد التنفيذ، ومتأخرة.
 * يُنفَّذ بعد الموارد البشرية لأنه يعتمد على الهيكل التنظيمي.
 */
@Injectable()
export class AuditSeed {
  constructor(
    private readonly db: DataSource,
    private readonly core: AuditCore,
    private readonly planning: PlanningService,
    private readonly engagements: EngagementService,
    private readonly actions: ActionsService,
  ) {}

  async run(team: DemoTeam, password: string) {
    const { admin } = team;
    const org = admin.organizationId;
    const year = Number(today().slice(0, 4));

    // ---- فريق المراجعة: المراجع الداخلي بدوره، والجهات المسؤولة تملك متابعة توصياتها
    const perms = (codes: string[]) => this.db.getRepository(Permission).find({ where: { code: In(codes) } });
    const auditorCodes = [P.read, P.universe, P.plans, P.engagements, P.fieldwork, P.verify, P.reports];
    const role = await this.db.getRepository(Role).save(this.db.getRepository(Role).create({
      organizationId: org, name: 'المراجع الداخلي', description: 'يعد خطط المراجعة وينفذ مهامها ويتابع التوصيات ويتحقق من إغلاقها', permissions: await perms(auditorCodes),
    }));
    const u = await this.db.getRepository(User).save(this.db.getRepository(User).create({
      organizationId: org, fullName: 'سلمان الحربي', email: team.email('auditor'), passwordHash: await bcrypt.hash(password, 12), roles: [role],
    }));
    const auditor = actorOf(org, u, auditorCodes, false, team.slug);
    // المدير المالي ومسؤولة تنمية الموارد يتابعان التوصيات المسندة لإدارتيهما
    const respond = (await perms([P.respond]))[0];
    for (const id of [team.roles.finance, team.roles.fundraiser, team.roles.caseManager]) {
      const r = await this.db.getRepository(Role).findOneOrFail({ where: { id }, relations: { permissions: true } });
      r.permissions = [...r.permissions, respond];
      await this.db.getRepository(Role).save(r);
    }
    const withRespond = (a: OrgUser) => ({ ...a, permissions: [...a.permissions, P.respond] });
    const finance = withRespond(team.finance);
    const fundraiser = withRespond(team.fundraiser);

    // ---- الهيكل والمخاطر (سجل المخاطر إن كانت وحدته مثبتة)
    const units = await this.core.units(org);
    const unit = (name: string) => units.find((x) => x.name === name)!.id;
    const U = {
      finance: unit('إدارة الشؤون المالية والإدارية'), resources: unit('إدارة تنمية الموارد'), social: unit('قسم البحث الاجتماعي'),
      projects: unit('قسم المشاريع'), hr: unit('قسم الموارد البشرية'), quality: unit('قسم الجودة'), exec: unit('الإدارة التنفيذية'),
    };
    const register = await this.core.risks(org);
    const refsFor = (unitId: string | null, words: string[]): RiskRef[] => register
      .filter((r: RegisterRisk) => (unitId && r.unitId === unitId) || words.some((w) => r.title.includes(w)))
      .slice(0, 3).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score }));

    // ---- مجالات المراجعة وتقييمها
    const area = async (code: string, name: string, category: string, unitId: string | null, likelihood: number, impact: number, controlRating: string, lastAuditDate: string | null, description: string, words: string[], outsideLabel?: string) =>
      (await this.planning.createArea(auditor, {
        code, name, category, scopeType: unitId ? 'unit' : 'outside', unitId, outsideLabel: outsideLabel ?? null, likelihood, impact, controlRating,
        lastAuditDate, description, riskRefs: refsFor(unitId, words),
      })).id;
    const A = {
      payments: await area('FIN-01', 'المدفوعات والصرف', 'financial', U.finance, 4, 4, 'weak', daysAgo(540), 'دورة الصرف من الطلب حتى سند الصرف والمستندات المؤيدة', ['صرف', 'مدفوعات']),
      donations: await area('FR-01', 'تحصيل التبرعات والإيصالات', 'fundraising', U.resources, 4, 3, 'adequate', daysAgo(420), 'الإيصالات والتحصيل الإلكتروني والتبرعات المقيدة', ['تبرع', 'تحصيل']),
      research: await area('BEN-01', 'البحث الاجتماعي واستحقاق الدعم', 'programs', U.social, 3, 5, 'adequate', null, 'سلامة قرارات الاستحقاق ونماذج البحث وتوثيق الزيارات', ['مستفيد', 'استحقاق']),
      payroll: await area('HR-01', 'الرواتب والتعيين', 'hr', U.hr, 3, 4, 'adequate', daysAgo(700), 'مسير الرواتب والبصمة والتعيين وفق خطة التعيين', ['رواتب', 'موظف']),
      partners: await area('PRT-01', 'الشركاء المنفذون', 'programs', null, 4, 4, 'unknown', null, 'التزام الشركاء المنفذين باتفاقيات التنفيذ وتقارير الإنجاز', ['شريك'], 'الشركاء المنفذون للمشاريع'),
      cash: await area('FIN-02', 'العهد النقدية والصندوق', 'financial', U.finance, 3, 3, 'adequate', daysAgo(800), 'العهد المستديمة وتسويتها والجرد المفاجئ', ['عهد', 'نقد']),
      projects: await area('PRJ-01', 'إدارة المشاريع والمنح', 'operational', U.projects, 3, 3, 'strong', daysAgo(200), 'الالتزام بميزانيات المشاريع وتقارير المانحين', ['مشروع', 'منح']),
      it: await area('IT-01', 'أمن المعلومات وصلاحيات الأنظمة', 'it', U.exec, 3, 4, 'weak', null, 'صلاحيات المستخدمين وحماية بيانات المستفيدين والمتبرعين', ['بيانات', 'معلومات']),
    };
    await this.planning.createArea(auditor, {
      code: 'GOV-01', name: 'محاضر مجلس الإدارة واللجان', category: 'governance', scopeType: 'unit', unitId: U.exec, likelihood: 2, impact: 3, controlRating: 'strong',
      lastAuditDate: daysAgo(150), description: 'انتظام الاجتماعات وتوثيق القرارات ومتابعتها', riskRefs: [],
    });

    // ---- الخطة الرئيسية والخطط الفرعية
    const yFrom = `${year}-01-01`;
    const yTo = `${year}-12-31`;
    const master = (await this.planning.createPlan(auditor, {
      kind: 'master', year, title: `الخطة السنوية للمراجعة الداخلية ${year}`, scopeType: 'org', periodFrom: yFrom, periodTo: yTo, availableHours: 900,
      objectives: 'تقديم تأكيد مستقل لمجلس الإدارة عن كفاية الضوابط في المجالات الأعلى خطرًا، ومتابعة علاج الملاحظات في مواعيدها.',
      methodology: 'منهجية مبنية على المخاطر: ترتيب مجالات المراجعة حسب (الاحتمال × الأثر) مع أثر تقييم الضوابط، وفق المعايير الدولية لممارسة المراجعة الداخلية.',
      riskRefs: register.filter((r) => ['high', 'critical'].includes(r.level)).slice(0, 5).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })),
    })).id;
    await this.planning.submitPlan(auditor, master);
    await this.planning.decide(admin, master, { decision: 'approve', note: 'اعتماد لجنة المراجعة في اجتماعها الأول' });
    const sub = async (title: string, unitId: string | null, outsideLabel: string | null, hours: number) => (await this.planning.createPlan(auditor, {
      kind: 'sub', parentId: master, year, title, scopeType: unitId ? 'unit' : 'outside', unitId, outsideLabel, periodFrom: yFrom, periodTo: yTo, availableHours: hours,
    })).id;
    const finPlan = await sub('خطة مراجعة الشؤون المالية والإدارية', U.finance, null, 300);
    const progPlan = await sub('خطة مراجعة البرامج وتنمية الموارد', U.resources, null, 300);
    const partnerPlan = await sub('خطة مراجعة الشركاء المنفذين', null, 'الشركاء المنفذون للمشاريع', 160);

    // المواعيد نسبةً لليوم، ومحصورة داخل سنة الخطة
    const inYear = (d: string) => (d < yFrom ? yFrom : d > yTo ? yTo : d);
    const eng = async (planId: string, areaId: string, title: string, unitId: string | null, priority: string, start: number, end: number, hours: number, outsideLabel?: string) =>
      (await this.engagements.create(auditor, {
        planId, areaId, title, scopeType: unitId ? 'unit' : 'outside', unitId, outsideLabel: outsideLabel ?? null, priority, plannedStart: inYear(daysAgo(start)),
        plannedEnd: inYear(daysAgo(end)), budgetHours: hours, leadUserId: auditor.id,
        team: [{ userId: team.quality.id, role: 'مراجع مساعد' }],
        objective: 'التحقق من كفاية وفاعلية الضوابط الرقابية والالتزام باللوائح المعتمدة',
        riskRefs: refsFor(unitId, []),
      })).id;
    const ePay = await eng(finPlan, A.payments, 'مراجعة دورة المدفوعات والصرف', U.finance, 'critical', 150, 110, 70);
    const eCash = await eng(finPlan, A.cash, 'مراجعة العهد النقدية والصندوق', U.finance, 'medium', 105, 90, 30);
    const eDon = await eng(progPlan, A.donations, 'مراجعة تحصيل التبرعات والإيصالات', U.resources, 'high', 80, 45, 60);
    const eRes = await eng(progPlan, A.research, 'مراجعة البحث الاجتماعي واستحقاق الدعم', U.social, 'high', 12, -14, 60);
    await eng(finPlan, A.payroll, 'مراجعة مسير الرواتب والبصمة', U.hr, 'high', -10, -35, 50);
    await eng(partnerPlan, A.partners, 'مراجعة التزام الشركاء المنفذين', null, 'high', -20, -40, 60, 'الشركاء المنفذون للمشاريع');
    for (const p of [finPlan, progPlan]) {
      await this.planning.submitPlan(auditor, p);
      await this.planning.decide(admin, p, { decision: 'approve', note: 'معتمدة' });
    }
    await this.planning.submitPlan(auditor, partnerPlan);

    // ---- تنفيذ المهام
    const start = (id: string) => this.engagements.stage(auditor, id, { action: 'start' }, false);
    const item = async (id: string, title: string, criteria: string, procedure: string) => (await this.engagements.addItem(auditor, id, { title, criteria, procedure })).id;
    const ok = (id: string, itemId: string, conclusion: string) => this.engagements.setResult(auditor, id, itemId, { result: 'satisfactory', conclusion });
    const finding = (id: string, itemId: string, f: { title: string; observation: string; cause: string; effect: string; rating: string; recommendation: string; unitId: string; userId?: string; due: number; response?: string }) =>
      this.engagements.addFinding(auditor, id, {
        itemId, title: f.title, observation: f.observation, cause: f.cause, effect: f.effect, rating: f.rating, recommendation: f.recommendation,
        responsibleUnitId: f.unitId, responsibleUserId: f.userId ?? null, dueDate: daysAhead(f.due), managementResponse: f.response ?? null,
      });

    // 1) المدفوعات: صدر التقرير بثلاث توصيات (أُغلقت واحدة، وواحدة بانتظار التحقق، وواحدة متأخرة)
    await start(ePay);
    const p1 = await item(ePay, 'اكتمال المستندات المؤيدة لسندات الصرف', 'اللائحة المالية: لا يُصرف إلا بمستند معتمد وفاتورة أصلية', 'فحص عينة عشوائية من 40 سند صرف خلال الربعين الأول والثاني');
    const p2 = await item(ePay, 'الفصل بين المهام في دورة الصرف', 'مصفوفة الصلاحيات المالية المعتمدة', 'مطابقة معد السند ومعتمده ومنفذ التحويل في العينة نفسها');
    const p3 = await item(ePay, 'حدود الصلاحيات المالية في الاعتماد', 'جدول الصلاحيات المالية المعتمد من المجلس', 'مقارنة مبالغ العينة بحدود صلاحية المعتمد');
    const p4 = await item(ePay, 'المطابقات البنكية الشهرية', 'إجراء المطابقة البنكية شهريًا خلال 10 أيام', 'فحص مطابقات 6 أشهر وتسوية البنود المعلقة');
    await ok(ePay, p2, 'لم يُلاحظ أن أحدًا أعدّ واعتمد السند نفسه في العينة كلها');
    await finding(ePay, p1, {
      title: 'سندات صرف دون فواتير أصلية', observation: '6 سندات من أصل 40 (15%) صُرفت بعروض أسعار دون فواتير نهائية بإجمالي 48,300 ريال.',
      cause: 'غياب قائمة تحقق إلزامية قبل الاعتماد، والاستعجال في صرف دفعات الموردين', effect: 'احتمال صرف مبالغ غير مستحقة وصعوبة إثبات الصرف أمام المانحين والجهات الرقابية',
      rating: 'high', recommendation: 'اعتماد قائمة تحقق إلزامية لمستندات الصرف في النظام المالي، واستكمال فواتير السندات الست خلال شهر.',
      unitId: U.finance, userId: team.finance.id, due: 25, response: 'نتفق مع الملاحظة وسيتم استكمال الفواتير وتفعيل قائمة التحقق',
    });
    await finding(ePay, p3, {
      title: 'اعتماد مبالغ تتجاوز حد الصلاحية', observation: 'سندان بمبلغ 62,000 و75,000 ريال اعتمدهما المدير المالي منفردًا، والحد المعتمد له 50,000 ريال.',
      cause: 'عدم ربط حدود الصلاحيات بمراحل الاعتماد في النظام', effect: 'مخالفة جدول الصلاحيات المعتمد من المجلس وإضعاف الرقابة الثنائية',
      rating: 'critical', recommendation: 'إضافة مرحلة اعتماد المدير التنفيذي للمبالغ فوق 50,000 ريال في إعدادات مراحل سندات الصرف، وعرض السندين على المجلس للمصادقة.',
      unitId: U.finance, userId: team.finance.id, due: 10,
    });
    await finding(ePay, p4, {
      title: 'تأخر المطابقات البنكية', observation: 'مطابقات ثلاثة أشهر أُعدت بعد 25 إلى 40 يومًا من نهاية الشهر، وفيها 4 بنود معلقة لأكثر من 60 يومًا.',
      cause: 'ضغط العمل في نهاية الشهر وعدم تحديد مسؤول بديل', effect: 'تأخر اكتشاف الأخطاء أو التحويلات غير المصرح بها',
      rating: 'medium', recommendation: 'تحديد مسؤول أساسي وبديل للمطابقات، ومتابعة البنود المعلقة شهريًا مع تقرير للمدير التنفيذي.',
      unitId: U.finance, due: 40,
    });
    await this.engagements.stage(auditor, ePay, { action: 'submit', actualHours: 74, note: 'مسودة التقرير جاهزة بعد مناقشة الإدارة المالية' }, false);
    await this.engagements.issue(admin, ePay, {
      summary: 'الضوابط في دورة الصرف تحتاج إلى تحسين: المستندات المؤيدة غير مكتملة في 15% من العينة، وتجاوز حدود الصلاحية في سندين، مع تأخر المطابقات البنكية. الفصل بين المهام فعّال.',
      opinion: 'needs_improvement',
    });

    // 2) العهد النقدية: بدون ملاحظات، أُغلقت بالتقرير مباشرة
    await start(eCash);
    for (const [t, c] of [['الجرد المفاجئ للصندوق', 'تطابق الرصيد الفعلي مع الدفتري في جردين مفاجئين'], ['تسوية العهد المستديمة', 'كل العهد سُويت خلال المهلة بمستندات مكتملة']] as const) {
      await ok(eCash, await item(eCash, t, 'سياسة العهد النقدية', 'جرد وفحص مستندي'), c);
    }
    await this.engagements.stage(auditor, eCash, { action: 'submit', actualHours: 26 }, false);
    await this.engagements.issue(admin, eCash, { summary: 'ضوابط العهد النقدية والصندوق كافية وفعالة، ولا توجد ملاحظات جوهرية.', opinion: 'satisfactory' });

    // 3) التبرعات: صدر التقرير وتوصيتان قيد التنفيذ
    await start(eDon);
    const d1 = await item(eDon, 'تسلسل الإيصالات وعدم تكرارها', 'لائحة تنمية الموارد', 'فحص تسلسل إيصالات 3 أشهر');
    const d2 = await item(eDon, 'الالتزام بشروط التبرعات المقيدة', 'سياسة التبرعات المقيدة', 'تتبع 10 تبرعات مقيدة حتى صرفها');
    await ok(eDon, d1, 'التسلسل مكتمل ولا توجد إيصالات ملغاة دون سبب');
    await finding(eDon, d2, {
      title: 'تبرعات مقيدة دون ربط بالمشروع', observation: '3 تبرعات مقيدة بمشروع كفالة الأيتام سُجلت عامة دون ربطها بالمشروع.',
      cause: 'اختيار نوع التبرع يدويًا عند الإدخال', effect: 'خطر صرف التبرع في غير ما خُصص له ومخالفة رغبة المتبرع',
      rating: 'high', recommendation: 'تصحيح تصنيف التبرعات الثلاثة، وجعل حقل المشروع إلزاميًا للتبرعات المقيدة.', unitId: U.resources, userId: team.fundraiser.id, due: 20,
    });
    await finding(eDon, d2, {
      title: 'تأخر إشعار المتبرعين بالصرف', observation: 'لم تُرسل تقارير الأثر لـ 5 متبرعين رئيسيين خلال المهلة المتفق عليها.',
      cause: 'عدم وجود جدول متابعة لتقارير المتبرعين', effect: 'إضعاف ثقة المتبرعين واحتمال عدم تجديد الدعم',
      rating: 'medium', recommendation: 'إعداد جدول زمني لتقارير الأثر للمتبرعين الرئيسيين ومتابعته شهريًا.', unitId: U.resources, due: 45,
    });
    await this.engagements.stage(auditor, eDon, { action: 'submit', actualHours: 58 }, false);
    await this.engagements.issue(admin, eDon, { summary: 'التحصيل والإيصالات منضبطة، مع ضعف في ربط التبرعات المقيدة بمشاريعها ومتابعة تقارير المتبرعين.', opinion: 'needs_improvement' });

    // 4) البحث الاجتماعي: قيد التنفيذ (بند مختبر وبند عليه ملاحظة وبند لم يُختبر)
    await start(eRes);
    const r1 = await item(eRes, 'اكتمال نموذج البحث الاجتماعي المعتمد', 'إجراءات المستفيدين ونموذج البحث QF-BEN-01', 'فحص 25 ملفًا معتمدًا');
    const r2 = await item(eRes, 'توثيق الزيارات الميدانية', 'دليل البحث الاجتماعي', 'مطابقة تقارير الزيارات بقرارات الاستحقاق');
    await item(eRes, 'مبررات مخالفة قواعد التقييم الاسترشادية', 'سياسة الاستحقاق', 'فحص كل الحالات المعلّمة بمخالفة القواعد');
    await ok(eRes, r1, 'النماذج مكتملة في كل العينة');
    await finding(eRes, r2, {
      title: 'زيارات ميدانية دون صور أو إحداثيات', observation: '4 ملفات من 25 تقرير زيارتها دون صور أو موقع.', cause: 'لا يوجد حقل إلزامي للمرفقات في نموذج الزيارة',
      effect: 'صعوبة التحقق من إجراء الزيارة فعلًا', rating: 'medium', recommendation: 'إضافة مرفق إلزامي لتقرير الزيارة في نموذج البحث.', unitId: U.social, due: 45,
    });

    // ---- متابعة التوصيات: الجهات المسؤولة تحدّث وتقدم تقارير الإغلاق، والمراجع يتحقق
    const acts = await this.db.getRepository(AuditAction).find({ where: { organizationId: org }, order: { code: 'ASC' } });
    const byTitle = (t: string) => acts.find((a) => a.title === t)!;
    const invoices = byTitle('سندات صرف دون فواتير أصلية');
    const limits = byTitle('اعتماد مبالغ تتجاوز حد الصلاحية');
    const recon = byTitle('تأخر المطابقات البنكية');
    const restricted = byTitle('تبرعات مقيدة دون ربط بالمشروع');
    const reports = byTitle('تأخر إشعار المتبرعين بالصرف');
    await this.actions.update(finance, limits.id, { progress: 60, text: 'أُضيفت مرحلة اعتماد المدير التنفيذي، وبانتظار عرض السندين على المجلس' });
    await this.actions.submitClosure(finance, limits.id, {
      title: 'تقرير علاج تجاوز حدود الصلاحية', refNo: 'م م/118', date: today(),
      summary: 'فُعّلت مرحلة اعتماد المدير التنفيذي للمبالغ فوق 50,000 ريال، وصادق المجلس على السندين في محضر الاجتماع الرابع.',
    });
    await this.actions.verify(auditor, limits.id, { decision: 'close', note: 'تم التحقق من إعدادات المراحل ومحضر المجلس' });
    await this.actions.update(finance, invoices.id, { progress: 70, text: 'استُكملت فواتير 5 سندات من 6، وقائمة التحقق مفعلة' });
    await this.actions.submitClosure(finance, invoices.id, {
      title: 'تقرير استكمال المستندات المؤيدة', refNo: 'م م/121', date: today(),
      summary: 'استُكملت الفواتير الست، وأصبحت قائمة التحقق إلزامية قبل اعتماد أي سند صرف.',
    });
    await this.engagements.addDocument(finance, 'action', invoices.id, 'محضر استكمال الفواتير', 'closure', demoPdf('invoices.pdf'));
    await this.actions.update(fundraiser, restricted.id, { progress: 40, text: 'صُحح تصنيف تبرعين، والثالث بانتظار تأكيد المتبرع' });
    await this.actions.extend(auditor, reports.id, { dueDate: daysAhead(60), reason: 'تزامن موعد التقارير مع نهاية الربع' });
    // توصية متأخرة: صدرت قبل شهرين ومضى موعدها دون إغلاق
    await this.db.getRepository(AuditAction).update({ id: recon.id }, { startDate: daysAgo(100), dueDate: daysAgo(18), originalDueDate: daysAgo(18) });
    await this.db.getRepository(AuditAction).update({ id: invoices.id }, { startDate: daysAgo(100) });
    await this.actions.update(finance, recon.id, { progress: 30, text: 'حُدد المسؤول البديل، وجاري تسوية البنود المعلقة' });

    // تواريخ فعلية واقعية للمهام المنتهية
    const eRepo = this.db.getRepository(AuditEngagement);
    await eRepo.update({ id: ePay }, { actualStart: daysAgo(148), actualEnd: daysAgo(112) });
    await eRepo.update({ id: eCash }, { actualStart: daysAgo(104), actualEnd: daysAgo(92) });
    await eRepo.update({ id: eDon }, { actualStart: daysAgo(78), actualEnd: daysAgo(47) });
    await eRepo.update({ id: eRes }, { actualStart: daysAgo(10) });
    return { role: 'المراجع الداخلي', email: u.email };
  }
}

/** ملف PDF صغير لتجربة المرفقات */
function demoPdf(name: string) {
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return { buffer, size: buffer.length, originalname: name, mimetype: 'application/pdf' } as Express.Multer.File;
}
