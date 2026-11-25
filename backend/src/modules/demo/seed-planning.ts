import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { periodEnd, periodsOf, plannedProgress } from '../planning/planning-calc';
import { PlanningCore } from '../planning/planning-core.service';
import { ItemDto } from '../planning/planning.dto';
import { PLANNING_PERMISSIONS as P } from '../planning/planning.manifest';
import { PlansService } from '../planning/plans.service';
import { PlanningLinks } from '../planning/planning-links.service';
import { DemoTeam, daysAgo } from './demo-context';

type PlanView = Awaited<ReturnType<PlansService['get']>>;
type Act = Partial<ItemDto> & { title: string; pace?: number; done?: boolean; corrective?: string; contributes?: [string, number | null][] };

/**
 * التخطيط في الشركة التجريبية: خطة استراتيجية خمسية من قالب الجمعيات الأهلية بإصدارين معتمدين (الثاني بمراجعة منتصف المدة)،
 * وخطط تشغيلية للإدارات للسنة الحالية مرتبطة بمبادرات الخطة الاستراتيجية بنسب مساهمة، بأنشطة في كل حالات التنفيذ
 * (منجز، حسب الخطة، في خطر، متأخر بإجراء تصحيحي)، وخطة تشغيلية للعام السابق رُحّل منها نشاط غير منتهٍ،
 * وخطة قيد الاعتماد، وقراءات مؤشرات للعام السابق والحالي، وربط مبادرات بمشروع وبموازنة رأسمالية.
 * كل العمليات عبر خدمات النظام نفسها (بنفس التحقق والترقيم ومسارات الاعتماد).
 */
@Injectable()
export class PlanningSeed {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly plans: PlansService, private readonly links: PlanningLinks) {}

  /** صلاحيات التخطيط لأدوار الفريق التجريبي */
  private async grant(team: DemoTeam): Promise<DemoTeam> {
    const out = { ...team };
    const codes: Partial<Record<keyof DemoTeam['roles'], string[]>> = {
      projectsManager: [P.read, P.operational, P.progress, P.reports],
      fundraiser: [P.read, P.operational, P.progress],
      finance: [P.read, P.operational, P.progress, P.reports],
      quality: [P.read, P.kpis, P.progress, P.reports],
      caseManager: [P.read, P.progress],
    };
    for (const [key, list] of Object.entries(codes) as [keyof DemoTeam['roles'], string[]][]) {
      const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: team.roles[key] }, relations: { permissions: true } });
      role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
      await this.db.getRepository(Role).save(role);
      out[key] = { ...team[key], permissions: [...new Set([...team[key].permissions, ...list])] };
    }
    return out;
  }

  private async approveAll(admin: OrgUser, id: string) {
    let p = await this.plans.get(admin, id);
    for (let i = 0; i < 8 && p.status === 'in_review'; i++) p = await this.plans.decide(admin, id, { decision: 'approve', note: 'قرار مجلس المديرين (بيانات تجريبية)' });
    return p;
  }

  private find(p: PlanView, title: string) {
    const it = p.items.find((i) => i.title === title);
    if (!it) throw new Error(`Planning seed: item not found: ${title}`);
    return it;
  }

  async run(demoTeam: DemoTeam) {
    const team = await this.grant(demoTeam);
    const { admin, fundraiser, projectsManager, finance, quality, caseManager } = team;
    const org = admin.organizationId;
    await this.core.settings(org);
    const today = daysAgo(0);
    const Y = Number(today.slice(0, 4));
    const units: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1', [org]);
    const unit = (name: string) => units.find((u) => u.name === name)?.id ?? null;
    const U = { exec: unit('الإدارة التنفيذية'), programs: unit('إدارة البرامج والخدمات'), resources: unit('إدارة تنمية الموارد'), finance: unit('إدارة الشؤون المالية والإدارية'), quality: unit('قسم الجودة') };

    // ---------------- الخطة الاستراتيجية ----------------
    let sp = await this.plans.create(admin, {
      kind: 'strategic', title: `الخطة الاستراتيجية ${Y - 1} - ${Y + 3}`, startYear: Y - 1, endYear: Y + 3, periodicity: 'annual', templateKey: 'ncnp-strategic',
      ownerName: admin.fullName, description: 'الخطة الاستراتيجية الخمسية للشركة، معدة بمشاركة مجلس الإدارة والإدارات وأصحاب المصلحة، ومبنية على تحليل البيئة الداخلية والخارجية.',
    });
    const goalSetup: [string, string | null, string][] = [
      ['رفع جودة الخدمات الاستشارية وقياس أثرها لدى العملاء', U.programs, caseManager.fullName],
      ['تنمية قاعدة العملاء وتكرار التعاقد', U.programs, projectsManager.fullName],
      ['تنويع مصادر الإيرادات وزيادتها', U.resources, fundraiser.fullName],
      ['رفع كفاءة الإنفاق', U.finance, finance.fullName],
      ['الالتزام بمعايير الحوكمة والشفافية', U.exec, admin.fullName],
      ['تطوير رأس المال البشري', U.finance, finance.fullName],
      ['التحول الرقمي وتميز العمليات', U.exec, quality.fullName],
      ['بناء شراكات استراتيجية فاعلة', U.resources, fundraiser.fullName],
      ['دعم الجمعيات الناشئة بخدمات مجانية', U.programs, caseManager.fullName],
    ];
    for (const [title, unitId, ownerName] of goalSetup) {
      await this.plans.updateItem(admin, this.find(sp, title).id, { unitId, ownerName });
    }
    const pillarWeights: [string, number][] = [['أثر العملاء وجودة الخدمات', 35], ['الاستدامة المالية', 30], ['الحوكمة والتميز المؤسسي', 20], ['الشراكات والمسؤولية المجتمعية', 15]];
    for (const [title, weight] of pillarWeights) await this.plans.updateItem(admin, this.find(sp, title).id, { weight, ownerName: admin.fullName });
    const cost = (a: number, b: number, c: number, d = 0, e = 0) => ({ [Y - 1]: a, [Y]: b, [Y + 1]: c, [Y + 2]: d, [Y + 3]: e });
    const initSetup: [string, Record<string, number>, string, 'restricted' | 'unrestricted' | 'mixed', string | null][] = [
      ['تطبيق منهجية لقياس أثر المشاريع لدى العملاء', cost(0, 60000, 40000, 20000), caseManager.fullName, 'unrestricted', U.programs],
      ['تطوير معايير الخدمة وأدلة الإجراءات', cost(30000, 20000, 0), quality.fullName, 'unrestricted', U.quality],
      ['برنامج متابعة العملاء بعد التسليم', cost(150000, 280000, 320000, 320000, 300000), projectsManager.fullName, 'restricted', U.programs],
      ['باقات خدمات سنوية للعملاء', cost(0, 500000, 1500000, 1000000), admin.fullName, 'mixed', U.resources],
      ['برنامج العقود الإطارية', cost(40000, 90000, 60000, 40000, 40000), fundraiser.fullName, 'unrestricted', U.resources],
      ['استكمال السياسات واللوائح ونشرها', cost(15000, 10000, 5000), admin.fullName, 'unrestricted', U.exec],
      ['برنامج تطوير القيادات والصف الثاني', cost(40000, 60000, 60000, 50000), finance.fullName, 'unrestricted', U.finance],
      ['أتمتة الإجراءات الرئيسية', cost(80000, 120000, 60000), quality.fullName, 'unrestricted', U.exec],
      ['تطبيق نظام إدارة الجودة ISO 9001', cost(45000, 35000, 15000, 15000, 15000), quality.fullName, 'unrestricted', U.quality],
      ['برنامج الشراكة مع القطاع الخاص', cost(10000, 25000, 25000, 25000, 25000), fundraiser.fullName, 'unrestricted', U.resources],
      ['برنامج الاستشارات المجانية للجمعيات الناشئة', cost(20000, 30000, 30000, 30000, 30000), caseManager.fullName, 'restricted', U.programs],
    ];
    for (const [title, costByYear, ownerName, fundingType, unitId] of initSetup) {
      await this.plans.updateItem(admin, this.find(sp, title).id, {
        costByYear, ownerName, fundingType, unitId, startDate: `${Y - 1}-01-01`, endDate: `${Y + 3}-12-31`,
        targets: [{ kind: 'time', text: 'اكتمال المبادرة ضمن مدة الخطة', value: null, unit: null, dueDate: `${Y + 3}-12-31` }],
      });
    }
    sp = await this.plans.get(admin, sp.id);
    for (const k of sp.kpis) await this.plans.updateKpi(admin, k.id, { ownerName: this.find(sp, sp.items.find((i) => i.id === k.itemId)?.title ?? '').ownerName ?? admin.fullName });
    // القضايا الجوهرية وخارطة المعنيين التي بُنيت عليها الخطة
    await this.plans.addContextBatch(admin, sp.id, [
      { title: 'الاعتماد على عدد محدود من العملاء', summary: 'نسبة كبيرة من الإيرادات تأتي من عميلين، فأي تأخر في تجديد عقديهما يهدد التشغيل.', recommendations: 'تنويع العملاء والقطاعات\nباقات سنوية متكررة\nمتابعة تركز الإيرادات ربعيًا' },
      { title: 'نقص الكفاءات المتخصصة', summary: 'الطلب على خدمات التحول الرقمي والحوكمة أعلى من قدرة الفريق الحالي.', recommendations: 'شبكة خبراء متعاونين\nخطة تدريب سنوية للفريق' },
      { title: 'التحول الرقمي للعمليات الداخلية', summary: 'كثير من الإجراءات ما زالت يدوية، مما يبطئ الخدمة ويرفع احتمال الخطأ.', recommendations: 'أتمتة الإجراءات الرئيسية\nلوحات مؤشرات للإدارة' },
    ], [
      { name: 'مجلس الإدارة', category: 'الحوكمة', definition: 'يعتمد الخطط والموازنات ويتابع الأداء.', expectsFromUs: 'تقارير أداء دورية\nالالتزام باللوائح', weExpect: 'اعتماد القرارات في وقتها\nالتوجيه الاستراتيجي' },
      { name: 'العملاء من الجمعيات', category: 'العملاء', definition: 'الجمعيات المتعاقدة على خدمات الشركة.', expectsFromUs: 'جودة الخدمة\nسعر مناسب', weExpect: 'السداد في الموعد\nتوفير البيانات اللازمة' },
      { name: 'فريق العمل', category: 'فريق العمل', definition: 'موظفو الشركة ومتعاونوها.', expectsFromUs: 'بيئة عمل محفزة\nمسار تطور واضح', weExpect: 'الالتزام بالجودة والمواعيد' },
      { name: 'المركز الوطني لتنمية القطاع غير الربحي', category: 'الجهات التنظيمية والإشرافية', definition: 'الجهة المشرفة على القطاع غير الربحي.', expectsFromUs: 'الالتزام بالأنظمة', weExpect: 'وضوح المعايير' },
    ]);
    await this.plans.submit(admin, sp.id, 'اعتماد الخطة الاستراتيجية بعد ورش العمل مع الإدارات');
    sp = await this.approveAll(admin, sp.id);

    // ربط مبادرات بمشروع من نظام المشاريع وببند من الموازنة الرأسمالية (قراءة فقط من النظامين)
    const lk = await this.core.lookups(admin);
    const project = (lk.projects as { id: string; name: string }[]).find((x) => /تمكين|أسر|كفالة/.test(x.name)) ?? (lk.projects as { id: string }[])[0];
    if (project) await this.plans.addRef(admin, this.find(sp, 'برنامج متابعة العملاء بعد التسليم').id, { system: 'projects', refId: project.id, contribution: 40, note: 'المشروع ينفذ جزءًا من المبادرة' });
    const capital = (lk.capitalLines as { id: string; name: string }[]).find((x) => /حاسب|أجهزة|خادم|نظام/.test(x.name)) ?? (lk.capitalLines as { id: string }[])[0];
    if (capital) await this.plans.addRef(admin, this.find(sp, 'أتمتة الإجراءات الرئيسية').id, { system: 'capital_budget', refId: capital.id, contribution: null, note: 'الأجهزة اللازمة للأتمتة' });

    // ---- مراجعة منتصف المدة: مبادرة جديدة، ورفع تكلفة الوقف، وتعديل مستهدف مؤشر → الإصدار الثاني
    const revenueGoal = this.find(sp, 'تنويع مصادر الإيرادات وزيادتها');
    await this.plans.addItem(admin, sp.id, {
      parentId: revenueGoal.id, title: 'منصة التبرع الإلكتروني والمتجر الخيري', ownerName: fundraiser.fullName, unitId: U.resources, fundingType: 'unrestricted',
      startDate: `${Y}-01-01`, endDate: `${Y + 2}-12-31`, costByYear: { [Y]: 70000, [Y + 1]: 30000, [Y + 2]: 20000 },
      targets: [{ kind: 'quantitative', text: 'تحصيل 15% من التبرعات إلكترونيًا', value: 15, unit: '%', dueDate: `${Y + 1}-12-31` }],
    });
    await this.plans.updateItem(admin, this.find(sp, 'باقات خدمات سنوية للعملاء').id, { costByYear: cost(0, 650000, 1500000, 1000000) });
    const sustain = sp.kpis.find((k) => k.name.startsWith('نسبة الإيرادات من مصادر مستدامة'));
    if (sustain) await this.plans.updateKpi(admin, sustain.id, { targets: { ...sustain.targets, [Y + 3]: 35 } });
    await this.plans.submit(admin, sp.id, 'مراجعة منتصف المدة: إضافة منصة التبرع الإلكتروني، ورفع مخصص الوقف، ورفع مستهدف الإيرادات المستدامة');
    sp = await this.approveAll(admin, sp.id);

    // ---- قراءات المؤشرات: العام السابق كاملًا، والعام الحالي لبعضها (قراءة أولية)
    const prevActual = (base: number | null, target: number, f: number) => Math.round(((base ?? target * 0.8) + (target - (base ?? target * 0.8)) * f) * 10) / 10;
    let n = 0;
    for (const k of sp.kpis) {
      const t1 = k.targets[String(Y - 1)];
      if (t1 !== undefined) await this.plans.reading(quality, k.id, { period: String(Y - 1), value: prevActual(k.baseline, t1, [1.05, 0.9, 0.7, 1, 0.85][n % 5]), note: 'من التقرير السنوي المعتمد' });
      const t2 = k.targets[String(Y)];
      if (t2 !== undefined && n % 3 !== 2) await this.plans.reading(quality, k.id, { period: String(Y), value: prevActual(k.baseline, t2, [0.95, 0.75, 0.55][n % 3]), note: 'قراءة أولية حتى تاريخه' });
      n += 1;
    }

    // ---------------- الخطط التشغيلية ----------------
    const yStart = `${Y}-01-01`;
    /** تاريخ داخل السنة الحالية من رقم الشهر واليوم */
    const d = (m: number, day = 1) => `${Y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const end = (m: number) => periodEnd(`${Y}-${String(m).padStart(2, '0')}`);
    const buildOp = async (owner: OrgUser, title: string, unitId: string | null, programs: { title: string; acts: Act[] }[], kpis: { name: string; unit: string; aggregation: 'sum' | 'last' | 'avg'; quarterly: number[]; readings: number[]; programTitle: string }[] = []) => {
      let op = await this.plans.create(owner, { kind: 'operational', title, startYear: Y, endYear: Y, periodicity: 'quarterly', unitId, parentPlanId: sp.id, ownerName: owner.fullName });
      const acts: { id: string; a: Act }[] = [];
      for (const prog of programs) {
        op = await this.plans.addItem(owner, op.id, { title: prog.title, ownerName: owner.fullName, unitId });
        const pid = this.find(op, prog.title).id;
        for (const a of prog.acts) {
          const { pace: _p, done: _d, corrective: _c, contributes: _x, ...dto } = a;
          op = await this.plans.addItem(owner, op.id, { ownerName: owner.fullName, ...dto, parentId: pid });
          acts.push({ id: op.items.find((i) => i.title === a.title && i.parentId === pid)!.id, a });
        }
      }
      for (const { id, a } of acts) {
        for (const [target, contribution] of a.contributes ?? []) {
          await this.plans.addLink(owner, { fromItemId: id, toItemId: this.find(sp, target).id, relation: 'contributes', contribution });
        }
      }
      for (const k of kpis) {
        const prog = this.find(op, k.programTitle);
        op = await this.plans.createKpi(owner, op.id, {
          itemId: prog.id, name: k.name, unit: k.unit, direction: 'up', frequency: 'quarterly', aggregation: k.aggregation, baseline: null,
          targets: Object.fromEntries(periodsOf(Y, 'quarterly').map((q, i) => [q, k.quarterly[i]])), weight: 1, ownerName: owner.fullName,
        });
      }
      return { op, acts, kpis };
    };
    /** الإنجاز التجريبي: نسبة من المخطط حتى اليوم (pace)، أو منجز */
    const progressAll = async (owner: OrgUser, acts: { id: string; a: Act }[]) => {
      for (const { id, a } of acts) {
        const planned = plannedProgress(a.startDate ?? null, a.endDate ?? null, today) ?? 0;
        if (!a.done && planned === 0) continue;
        const progress = a.done ? 100 : Math.max(5, Math.min(95, Math.round((planned * (a.pace ?? 1)) / 5) * 5));
        const mid = daysAgo(Math.max(1, Math.round((Date.parse(today) - Date.parse(a.startDate ?? yStart)) / 86400000 / 2)));
        if (!a.done && progress > 20) await this.plans.progress(owner, id, { progress: Math.round(progress / 10) * 5, updateDate: mid < yStart ? yStart : mid, note: 'تحديث دوري' });
        const ms = a.milestones?.map((m) => !!m.dueDate && (a.done || m.dueDate < today) && (a.pace ?? 1) >= 0.8);
        await this.plans.progress(owner, id, {
          progress, updateDate: today, note: a.done ? 'اكتمل التنفيذ وسُلّمت المخرجات' : (a.pace ?? 1) < 0.7 ? 'تأخر في التنفيذ' : 'التنفيذ حسب الخطة',
          correctiveAction: a.corrective ?? null, milestonesDone: ms,
        });
      }
    };
    const readAll = async (owner: OrgUser, op: PlanView, kpis: { name: string; readings: number[] }[]) => {
      const full = await this.plans.get(owner, op.id);
      for (const k of kpis) {
        const kk = full.kpis.find((x) => x.name === k.name)!;
        for (const [i, q] of periodsOf(Y, 'quarterly').entries()) if (periodEnd(q) < today && k.readings[i] !== undefined) await this.plans.reading(owner, kk.id, { period: q, value: k.readings[i], note: null });
      }
    };

    // ---- العام السابق (تنمية الموارد): نشاط لم يكتمل يُرحّل للعام الحالي
    let prev = await this.plans.create(fundraiser, { kind: 'operational', title: `الخطة التشغيلية لإدارة تنمية الموارد ${Y - 1}`, startYear: Y - 1, endYear: Y - 1, periodicity: 'quarterly', unitId: U.resources, parentPlanId: sp.id });
    prev = await this.plans.addItem(fundraiser, prev.id, { title: 'برنامج العقود الإطارية', ownerName: fundraiser.fullName });
    const prevProg = this.find(prev, 'برنامج العقود الإطارية');
    prev = await this.plans.addItem(fundraiser, prev.id, { parentId: prevProg.id, title: 'تصميم باقات الاستقطاع', startDate: `${Y - 1}-02-01`, endDate: `${Y - 1}-05-31`, costByYear: { [Y - 1]: 15000 }, ownerName: fundraiser.fullName });
    prev = await this.plans.addItem(fundraiser, prev.id, { parentId: prevProg.id, title: 'ربط الاستقطاع مع البنوك', startDate: `${Y - 1}-06-01`, endDate: `${Y - 1}-12-31`, costByYear: { [Y - 1]: 25000 }, ownerName: fundraiser.fullName });
    await this.plans.addLink(fundraiser, { fromItemId: this.find(prev, 'تصميم باقات الاستقطاع').id, toItemId: this.find(sp, 'برنامج العقود الإطارية').id, relation: 'contributes', contribution: 20 });
    await this.plans.submit(fundraiser, prev.id, null);
    prev = await this.approveAll(admin, prev.id);
    await this.plans.progress(fundraiser, this.find(prev, 'تصميم باقات الاستقطاع').id, { progress: 100, updateDate: `${Y - 1}-05-28`, note: 'اعتُمدت ثلاث باقات' });
    await this.plans.progress(fundraiser, this.find(prev, 'ربط الاستقطاع مع البنوك').id, { progress: 60, updateDate: `${Y - 1}-12-20`, note: 'اكتمل الربط مع بنكين من ثلاثة', correctiveAction: 'ترحيل الربط مع البنك الثالث للعام القادم' });

    // ---- تنمية الموارد (معتمدة)
    const res = await buildOp(fundraiser, `الخطة التشغيلية لإدارة تنمية الموارد ${Y}`, U.resources, [
      {
        title: 'برنامج العقود الإطارية', acts: [
          { title: 'حملة تسويق الاستقطاع عبر القنوات الرقمية', startDate: d(1, 15), endDate: end(9), costByYear: { [Y]: 45000 }, pace: 1, contributes: [['برنامج العقود الإطارية', 50]],
            milestones: [{ title: 'إطلاق الحملة', dueDate: d(2, 1), done: false }, { title: 'تقرير منتصف الحملة', dueDate: d(5, 31), done: false }],
            resources: [{ kind: 'human', name: 'أخصائي تسويق رقمي', quantity: 1, unit: 'موظف', cost: null }, { kind: 'financial', name: 'إعلانات ممولة', quantity: null, unit: null, cost: 30000 }] },
          { title: 'تطبيق الاستقطاع عبر بوابة الدفع', startDate: d(1, 1), endDate: end(4), costByYear: { [Y]: 20000 }, done: true, contributes: [['منصة التبرع الإلكتروني والمتجر الخيري', 40]] },
        ],
      },
      {
        title: 'برنامج الشراكات المؤسسية', acts: [
          { title: 'زيارات تعريفية لعشرين شركة', startDate: d(2, 1), endDate: end(11), costByYear: { [Y]: 12000 }, pace: 0.45, contributes: [['برنامج الشراكة مع القطاع الخاص', 60]],
            corrective: 'تكليف موظف إضافي بملف الشركات، وجدولة زيارتين أسبوعيًا حتى نهاية الربع', milestones: [{ title: 'إعداد ملف التعريف بالشركة', dueDate: d(2, 28), done: false }] },
          { title: 'توقيع اتفاقيات المسؤولية المجتمعية', startDate: d(4, 1), endDate: end(12), costByYear: { [Y]: 8000 }, pace: 0.85, contributes: [['برنامج الشراكة مع القطاع الخاص', 40]] },
        ],
      },
    ], [
      { name: 'عدد المستقطعين الجدد', unit: 'عدد', aggregation: 'sum', quarterly: [150, 200, 200, 250], readings: [160, 140, 175], programTitle: 'برنامج العقود الإطارية' },
      { name: 'عدد الشركات الشريكة الجديدة', unit: 'عدد', aggregation: 'sum', quarterly: [1, 2, 2, 3], readings: [1, 1, 0], programTitle: 'برنامج الشراكات المؤسسية' },
    ]);
    await this.plans.submit(fundraiser, res.op.id, null);
    await this.approveAll(admin, res.op.id);
    await progressAll(fundraiser, res.acts);
    await readAll(fundraiser, res.op, res.kpis);
    // ترحيل النشاط غير المنتهي من العام السابق إلى برنامج الاستقطاع في خطة العام الحالي
    const resNow = await this.plans.get(fundraiser, res.op.id);
    await this.plans.carry(fundraiser, this.find(prev, 'ربط الاستقطاع مع البنوك').id, {
      targetPlanId: res.op.id, targetParentId: this.find(resNow, 'برنامج العقود الإطارية').id, note: 'استكمال الربط مع البنك الثالث',
    });
    await this.plans.submit(fundraiser, res.op.id, 'إضافة النشاط المُرحّل من خطة العام السابق');
    await this.approveAll(admin, res.op.id);

    // ---- البرامج والخدمات (معتمدة)
    const prog = await buildOp(projectsManager, `الخطة التشغيلية لإدارة البرامج والخدمات ${Y}`, U.programs, [
      {
        title: 'برنامج التمكين الاقتصادي', acts: [
          { title: 'دورات تدريبية في المهن والحرف', startDate: d(1, 10), endDate: end(6), costByYear: { [Y]: 85000 }, done: true, contributes: [['برنامج متابعة العملاء بعد التسليم', 40]],
            targets: [{ kind: 'quantitative', text: 'تدريب 60 مستفيدًا', value: 60, unit: 'مستفيد', dueDate: end(6) }] },
          { title: 'تمويل المشاريع الصغيرة للأسر المنتجة', startDate: d(3, 1), endDate: end(12), costByYear: { [Y]: 150000 }, pace: 0.6, contributes: [['برنامج متابعة العملاء بعد التسليم', 60]],
            corrective: 'تسريع دراسة طلبات التمويل بلجنة أسبوعية، والتنسيق مع بنك التنمية الاجتماعية', fundingType: 'restricted',
            milestones: [{ title: 'اعتماد معايير التمويل', dueDate: d(3, 31), done: false }, { title: 'صرف الدفعة الأولى', dueDate: d(6, 30), done: false }] },
        ],
      },
      {
        title: 'قياس الأثر الاجتماعي', acts: [
          { title: 'إعداد أدوات قياس الأثر واستبانات المستفيدين', startDate: d(1, 1), endDate: end(3), costByYear: { [Y]: 15000 }, done: true, contributes: [['تطبيق منهجية لقياس أثر المشاريع لدى العملاء', 30]] },
          { title: 'دراسة أثر برنامج الكفالة', startDate: d(4, 1), endDate: end(10), costByYear: { [Y]: 45000 }, pace: 0.95, contributes: [['تطبيق منهجية لقياس أثر المشاريع لدى العملاء', 70]] },
          { title: 'برنامج تأهيل المتطوعين الميدانيين', startDate: d(2, 1), endDate: end(8), costByYear: { [Y]: 20000 }, pace: 0.8, contributes: [['برنامج الاستشارات المجانية للجمعيات الناشئة', 100]] },
        ],
      },
    ], [
      { name: 'عدد الأسر المستفيدة من التمكين', unit: 'عدد', aggregation: 'sum', quarterly: [10, 15, 15, 20], readings: [12, 11, 9], programTitle: 'برنامج التمكين الاقتصادي' },
    ]);
    await this.plans.submit(projectsManager, prog.op.id, null);
    await this.approveAll(admin, prog.op.id);
    await progressAll(projectsManager, prog.acts);
    await readAll(projectsManager, prog.op, prog.kpis);

    // ---- الشؤون المالية والإدارية (قيد الاعتماد الآن)
    const fin = await buildOp(finance, `الخطة التشغيلية لإدارة الشؤون المالية والإدارية ${Y}`, U.finance, [
      {
        title: 'التحول الرقمي للعمليات المالية', acts: [
          { title: 'أتمتة دورة طلبات الصرف والاعتماد', startDate: d(1, 1), endDate: end(6), costByYear: { [Y]: 40000 }, contributes: [['أتمتة الإجراءات الرئيسية', 40]] },
          { title: 'الربط الإلكتروني مع البنوك', startDate: d(5, 1), endDate: end(12), costByYear: { [Y]: 30000 }, contributes: [['أتمتة الإجراءات الرئيسية', 30]] },
        ],
      },
      {
        title: 'تطوير الموارد البشرية', acts: [
          { title: 'خطة تدريب الموظفين السنوية', startDate: d(1, 1), endDate: end(12), costByYear: { [Y]: 60000 }, contributes: [['برنامج تطوير القيادات والصف الثاني', 50]] },
        ],
      },
    ]);
    await this.plans.submit(finance, fin.op.id, null);
    // اعتماد أولي من الإدارة التنفيذية، وتنتظر قرار مجلس المديرين (فيُطبع تقرير اعتمادها للمجلس)
    await this.plans.decide(admin, fin.op.id, { decision: 'approve', note: 'متوافقة مع احتياج الإدارة' });

    // ---- خطة الجودة: مسودة (ليظهر الإعداد قبل الرفع)
    let q = await this.plans.create(admin, { kind: 'operational', title: `الخطة التشغيلية لقسم الجودة ${Y}`, startYear: Y, endYear: Y, periodicity: 'quarterly', unitId: U.quality, parentPlanId: sp.id });
    q = await this.plans.addItem(admin, q.id, { title: 'تجديد شهادة ISO 9001', ownerName: quality.fullName });
    await this.plans.addItem(admin, q.id, { parentId: this.find(q, 'تجديد شهادة ISO 9001').id, title: 'المراجعة الداخلية الشاملة', startDate: d(9, 1), endDate: end(10), costByYear: { [Y]: 18000 } });
    await this.integrations(admin, projectsManager, finance, sp.id, prog.op.id, fin.op.id, Y);
    return { strategic: sp.id };
  }

  /**
   * الربط بالأنظمة الأخرى (المرحلة الخامسة): عناصر SWOT/PESTEL المعتمدة بأهداف ومبادرات الخطة الاستراتيجية،
   * والمخاطر الجوهرية بمبادرات ونشاط معالجة بتكلفة، وإجراءات تصحيحية للمراجعة الداخلية، وأهداف وظيفية بأنشطة.
   * وخطر رُبط بدرجة أقل من درجته الحالية ليظهر تنبيه «ارتفاع الخطر منذ الربط».
   */
  private async integrations(admin: OrgUser, pm: OrgUser, finance: OrgUser, spId: string, progId: string, finId: string, Y: number) {
    const sp = await this.plans.get(admin, spId);
    const has = (p: PlanView, t: string) => p.items.some((i) => i.title === t);
    const factors = await this.links.options(admin, 'risk_analysis');
    const pick = (f: string, n = 0) => factors.filter((x) => x.meta.factor === f)[n];
    const anLinks: [string | undefined, string, string][] = [
      [pick('opportunity')?.id, 'منصة التبرع الإلكتروني والمتجر الخيري', 'استثمار الفرصة في التحليل'],
      [pick('opportunity', 1)?.id, 'تنويع مصادر الإيرادات وزيادتها', 'استثمار الفرصة في التحليل'],
      [pick('threat')?.id, 'تنويع مصادر الإيرادات وزيادتها', 'الاستجابة للتهديد بتنويع الإيرادات'],
      [pick('weakness')?.id, 'أتمتة الإجراءات الرئيسية', 'معالجة نقطة الضعف'],
      [pick('strength')?.id, 'برنامج متابعة العملاء بعد التسليم', 'البناء على نقطة القوة'],
      [pick('economic')?.id, 'باقات خدمات سنوية للعملاء', 'العامل الاقتصادي أساس قرار الباقات السنوية'],
    ];
    for (const [refId, title, note] of anLinks) if (refId && has(sp, title)) await this.plans.addRef(admin, this.find(sp, title).id, { system: 'risk_analysis', refId, note }).catch(() => null);

    const risks = (await this.links.options(admin, 'risk')).filter((r) => r.meta.state !== 'closed');
    const material = risks.filter((r) => ['high', 'critical'].includes(String(r.meta.level)));
    const inits = ['برنامج العقود الإطارية', 'منصة التبرع الإلكتروني والمتجر الخيري', 'أتمتة الإجراءات الرئيسية', 'برنامج تطوير القيادات والصف الثاني'].filter((t) => has(sp, t));
    for (const [n, r] of material.slice(0, inits.length).entries()) await this.plans.addRef(admin, this.find(sp, inits[n]).id, { system: 'risk', refId: r.id, note: 'المبادرة تخفف هذا الخطر' }).catch(() => null);
    // خطر رُبط حين كانت درجته أقل: يظهر تنبيه ارتفاع الدرجة
    const raised = material[0];
    if (raised) await this.db.query(`UPDATE plan_refs SET ref_meta = ref_meta || jsonb_build_object('score', GREATEST(1, (ref_meta->>'score')::int - 4), 'levelName', 'متوسط') WHERE organization_id = $1 AND system = 'risk' AND ref_id = $2`, [admin.organizationId, raised.id]);

    // نشاط معالجة لخطر جوهري وإجراء تصحيحي لتوصية مراجعة في خطة البرامج المعتمدة، ثم إعادة اعتمادها
    let prog = await this.plans.get(pm, progId);
    const parent = prog.items.find((i) => i.level === 0);
    const treatRisk = material.find((r) => r.id !== raised?.id) ?? raised;
    if (parent && treatRisk) {
      prog = await this.plans.treatment(pm, parent.id, {
        system: 'risk', refId: treatRisk.id, title: `معالجة الخطر ${treatRisk.code}: ${treatRisk.label}`.slice(0, 300), ownerName: pm.fullName,
        startDate: `${Y}-07-01`, endDate: `${Y}-12-31`, costByYear: { [Y]: 35000 },
      });
    }
    const actions = (await this.links.options(admin, 'audit')).filter((x) => x.meta.status !== 'closed');
    if (parent && actions[0]) {
      prog = await this.plans.treatment(pm, parent.id, { system: 'audit', refId: actions[0].id, ownerName: pm.fullName, startDate: `${Y}-06-01`, costByYear: { [Y]: 12000 } });
    }
    if (prog.status !== 'approved') {
      await this.plans.submit(pm, progId, 'إضافة نشاط معالجة خطر وإجراء تصحيحي لتوصية المراجعة الداخلية');
      await this.approveAll(admin, progId);
    }
    const fin = await this.plans.get(finance, finId);
    if (actions[1] && has(fin, 'أتمتة دورة طلبات الصرف والاعتماد')) await this.plans.addRef(finance, this.find(fin, 'أتمتة دورة طلبات الصرف والاعتماد').id, { system: 'audit', refId: actions[1].id, note: 'الأتمتة تعالج ملاحظة المراجعة' }).catch(() => null);

    // أهداف وظيفية معتمدة مرتبطة بأنشطة البرامج
    prog = await this.plans.get(pm, progId);
    const goals = await this.links.options(admin, 'hr_performance');
    const acts = prog.items.filter((i) => !prog.items.some((c) => c.parentId === i.id));
    for (const [n, g] of goals.slice(0, Math.min(3, acts.length)).entries()) await this.plans.addRef(admin, acts[n].id, { system: 'hr_performance', refId: g.id, contribution: null, note: 'الهدف الوظيفي يسهم في النشاط' }).catch(() => null);
  }
}
