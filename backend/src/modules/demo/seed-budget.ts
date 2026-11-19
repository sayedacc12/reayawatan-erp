import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { OrgService } from '../hr/org.service';
import { BudgetsService } from '../planning/budget/budgets.service';
import { FormulasService } from '../planning/budget/formulas.service';
import { ScenariosService } from '../planning/budget/scenarios.service';
import { PLANNING_PERMISSIONS as P } from '../planning/planning.manifest';
import { PlansService } from '../planning/plans.service';
import { DemoTeam, daysAgo } from './demo-context';

/**
 * الموازنة التقديرية في الجمعية التجريبية للسنة القادمة، مبنية من بيانات الأنظمة الأخرى:
 * الموظفون ورواتبهم من الموارد البشرية، وخطة تعيين للسنة القادمة، والمصروفات والإيرادات الفعلية من المحاسبة،
 * وأنشطة خطة تشغيلية معتمدة للسنة القادمة، وموازنات المشاريع. مع افتراضات بقيم مرحلية، وقواعد علاوات،
 * ومعادلة خاصة، واستبعاد مصروف غير متكرر، وعقد جديد، وتعديل يدوي بمبرر، وسقوف للإدارات.
 * اعتُمد الإصدار الأول ثم عُدّلت نسبة العلاوة واعتُمد الإصدار الثاني (لمقارنة الإصدارات).
 * وثلاثة سيناريوهات للمقارنة: متحفظ (انخفاض التبرعات وعلاوة أقل وإلغاء وظيفة)، وتوسعي، وتأجيل الأنشطة.
 * كل العمليات عبر خدمات النظام نفسها.
 */
@Injectable()
export class BudgetSeed {
  constructor(
    private readonly db: DataSource,
    private readonly budgets: BudgetsService,
    private readonly formulas: FormulasService,
    private readonly plans: PlansService,
    private readonly hrOrg: OrgService,
    private readonly scenarios: ScenariosService,
  ) {}

  private async grant(team: DemoTeam) {
    const role = await this.db.getRepository(Role).findOneOrFail({ where: { id: team.roles.finance }, relations: { permissions: true } });
    const list = [P.budgets, P.budgetsHr, P.formulas];
    role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(list) } }))];
    await this.db.getRepository(Role).save(role);
    return { ...team.finance, permissions: [...new Set([...team.finance.permissions, ...list])] } as OrgUser;
  }

  private async approve(admin: OrgUser, id: string) {
    let b = await this.budgets.get(admin, id);
    for (let i = 0; i < 8 && b.status === 'in_review'; i++) b = await this.budgets.decide(admin, id, { decision: 'approve', note: null });
    return b;
  }

  async run(team: DemoTeam, strategicId: string) {
    const { admin, projectsManager } = team;
    const finance = await this.grant(team);
    const org = admin.organizationId;
    const Y = Number(daysAgo(0).slice(0, 4)) + 1;
    const units: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM hr_units WHERE organization_id = $1', [org]);
    const unit = (name: string) => units.find((u) => u.name === name)?.id ?? null;
    const jobs: { id: string; title: string }[] = await this.db.query('SELECT id, title FROM hr_jobs WHERE organization_id = $1', [org]);
    const job = (title: string) => jobs.find((j) => j.title === title)?.id;

    // ---- خطة التعيين للسنة القادمة (من الموارد البشرية)
    for (const [title, count, plannedMonth, fundingSource] of [['أخصائي اجتماعي', 2, 4, 'grant'], ['أخصائي تنمية موارد', 1, 7, 'own']] as const) {
      const id = job(title);
      if (!id) continue;
      const p = await this.hrOrg.createPlan(admin, { year: Y, jobId: id, count, plannedMonth, fundingSource, fundingNote: fundingSource === 'grant' ? 'منحة البرامج الاجتماعية' : null, forSaudi: true, justification: 'التوسع في البرامج حسب الخطة الاستراتيجية' });
      await this.hrOrg.submitPlan(admin, p.id);
      await this.hrOrg.decidePlan(admin, p.id, { decision: 'approve', note: null });
    }

    // ---- خطة تشغيلية معتمدة للسنة القادمة (مصدر بنود الأنشطة)
    const U = unit('إدارة البرامج والخدمات');
    let op = await this.plans.create(admin, { kind: 'operational', title: `الخطة التشغيلية لإدارة البرامج والخدمات ${Y}`, startYear: Y, endYear: Y, periodicity: 'quarterly', unitId: U, parentPlanId: strategicId, ownerName: projectsManager.fullName });
    op = await this.plans.addItem(admin, op.id, { title: 'برنامج التمكين الاقتصادي للأسر', ownerName: projectsManager.fullName, unitId: U });
    const pid = op.items.find((i) => i.title === 'برنامج التمكين الاقتصادي للأسر')!.id;
    for (const [title, from, to, cost, funding] of [
      ['دورات المهارات المهنية للأسر المنتجة', '01-15', '06-30', 120000, 'restricted'],
      ['معرض الأسر المنتجة السنوي', '10-01', '10-31', 65000, 'unrestricted'],
      ['قروض حسنة لمشاريع متناهية الصغر', '03-01', '12-31', 250000, 'restricted'],
      ['قياس أثر برنامج التمكين', '11-01', '12-31', 30000, 'unrestricted'],
    ] as const) {
      op = await this.plans.addItem(admin, op.id, {
        parentId: pid, title, ownerName: projectsManager.fullName, startDate: `${Y}-${from}`, endDate: `${Y}-${to}`, costByYear: { [Y]: cost }, fundingType: funding,
      });
    }
    await this.plans.submit(admin, op.id, null);
    let opv = await this.plans.get(admin, op.id);
    for (let i = 0; i < 8 && opv.status === 'in_review'; i++) opv = await this.plans.decide(admin, op.id, { decision: 'approve', note: null });

    // ---- معادلة خاصة بالجمعية
    await this.formulas.create(finance, {
      code: 'OPEX_FLEET', name: 'مصروفات الأسطول حسب عدد الرحلات', target: 'opex', expression: 'hist_avg * volume_ratio * (1 + fuel_increase)',
      description: 'المصروف التاريخي معدّلًا بنسبة الزيادة في رحلات نقل المستفيدين وزيادة أسعار الوقود.',
    });

    // ---- الموازنة
    let b = await this.budgets.create(finance, {
      title: `الموازنة التقديرية لعام ${Y}`, fiscalYear: Y, methodology: 'mixed', historyYears: 3,
      description: 'موازنة شاملة مبنية على الرواتب الفعلية وخطة التعيين، والمصروفات الفعلية مع الاستبعادات، وأنشطة الخطط التشغيلية، وموازنات المشاريع.',
    });
    const id = b.id;
    const vars = b.variables.map((v) => (v.key === 'medical_monthly' ? { ...v, steps: [{ fromMonth: 7, value: 520 }], note: 'تجديد وثيقة التأمين الطبي في يوليو بسعر أعلى' } : v));
    vars.push({ key: 'fuel_increase', name: 'زيادة أسعار الوقود', value: 0.08, unit: 'نسبة', steps: [], unitId: null, note: null });
    if (U) vars.push({ key: 'growth', name: 'الزيادة العامة في المصروفات', value: 0.06, unit: 'نسبة', steps: [], unitId: U, note: 'توسع البرامج' });
    b = await this.budgets.update(finance, id, {
      variables: vars,
      raiseRules: [
        { key: 'r1', name: 'علاوة التميز لتقييم ممتاز', pct: 8, fromMonth: 1, appliesToNew: false, match: { unitId: null, gradeName: null, jobTitle: null, rating: 'ممتاز', nationality: null } },
        { key: 'r2', name: 'علاوة إدارة البرامج (من أبريل)', pct: 6, fromMonth: 4, appliesToNew: false, match: { unitId: U, gradeName: null, jobTitle: null, rating: null, nationality: null } },
      ],
      ceilings: [unit('إدارة البرامج والخدمات'), unit('إدارة الشؤون المالية والإدارية'), unit('الإدارة التنفيذية')].filter((x): x is string => !!x)
        .map((unitId, i) => ({ unitId, amount: [600000, 450000, 500000][i] })),
    });
    for (const source of ['employees', 'staffing', 'expenses', 'revenues', 'activities', 'projects'] as const) await this.budgets.importLines(finance, id, { source });
    b = await this.budgets.get(finance, id);

    type L = { id: string; section: string; kind: string; name: string; included: boolean; history: { entries?: { id: string; amount: number }[] }; amount: number };
    const lines = b.lines as L[];
    const byName = (section: string, part: string) => lines.find((l) => l.section === section && l.name.includes(part));
    // استبعاد قيد غير متكرر من المتوسط التاريخي
    const withEntries = lines.filter((l) => l.section === 'opex' && l.kind === 'account' && l.included && (l.history.entries ?? []).length > 1).sort((x, y) => y.amount - x.amount)[0];
    if (withEntries) {
      const big = [...withEntries.history.entries!].sort((x, y) => y.amount - x.amount)[0];
      await this.budgets.updateLine(finance, withEntries.id, { params: { excludedEntryIds: [big.id] }, note: 'استُبعد قيد غير متكرر من المتوسط التاريخي' });
    }
    // بنود لا تدخل الموازنة التشغيلية
    const zakat = byName('opex', 'الزكاة');
    if (zakat) await this.budgets.updateLine(finance, zakat.id, { included: false, note: 'الزكاة تُصرف من إيرادات الزكاة لمستحقيها ولا تُحمّل على الموازنة التشغيلية' });
    const waqf = lines.find((l) => l.kind === 'project' && l.name.includes('وقف'));
    if (waqf) await this.budgets.updateLine(finance, waqf.id, { included: false, note: 'مشروع وقفي رأسمالي يتبع الموازنة الرأسمالية' });
    // عقد جديد على بند الكهرباء (مبنى جديد من أبريل)
    const power = byName('opex', 'الكهرباء');
    if (power) await this.budgets.updateLine(finance, power.id, { params: { contracts: [{ name: 'كهرباء مبنى مركز التمكين الجديد', amount: 24000, fromMonth: 4, toMonth: 12, kind: 'new' }] } });
    // معادلة الأسطول على صيانة السيارات
    const fleet = byName('opex', 'السيارات');
    if (fleet) await this.budgets.updateLine(finance, fleet.id, { params: { formulaCode: 'OPEX_FLEET', volumeBase: 1200, volumeTarget: 1500 }, note: 'زيادة رحلات نقل المستفيدين من 1200 إلى 1500 رحلة' });
    // تعديل يدوي بمبرر
    const ops = byName('opex', 'مصاريف التشغيل');
    if (ops) await this.budgets.updateLine(finance, ops.id, { overrideAmount: Math.round(ops.amount * 0.9), overrideNote: 'خطة ترشيد بنسبة 10% حسب توجيه المدير التنفيذي' });
    // مصروف موارد بشرية آخر بمبلغ محدد
    await this.budgets.addLine(finance, id, { section: 'hr', kind: 'hr_other', name: 'مكافآت اللجان والمتعاونين', unitId: unit('الإدارة التنفيذية'), params: { manualAmount: 60000 } });
    // إيراد متوقع جديد بلا تاريخ
    await this.budgets.addLine(finance, id, { section: 'revenue', kind: 'manual', name: 'منحة مؤسسة مانحة لبرنامج التمكين', params: { manualAmount: 400000, distribution: 'custom', weights: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] } });
    await this.budgets.addLine(finance, id, { section: 'revenue', kind: 'manual', name: 'حملة رمضان للتبرعات', params: { manualAmount: 1200000, distribution: 'custom', weights: [0, 2, 6, 1, 0, 0, 0, 0, 0, 0, 0, 1] } });
    await this.budgets.addLine(finance, id, { section: 'revenue', kind: 'manual', name: 'دعم المركز الوطني لتنمية القطاع غير الربحي', params: { manualAmount: 800000, distribution: 'custom', weights: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1] } });

    // الاعتماد: الإصدار الأول
    await this.budgets.submit(finance, id, null);
    await this.approve(admin, id);
    // تعديل بعد الاعتماد: رفع العلاوة العامة، ثم اعتماد الإصدار الثاني
    b = await this.budgets.get(finance, id);
    await this.budgets.update(finance, id, { variables: b.variables.map((v) => (v.key === 'general_raise' ? { ...v, value: 6 } : v)) });
    await this.budgets.submit(finance, id, 'رفع العلاوة العامة إلى 6% بقرار مجلس الإدارة');
    await this.approve(admin, id);

    // السيناريوهات
    const setVar = (sc: { variables: { key: string; value: number }[] }, key: string, value: number) => sc.variables.map((v) => (v.key === key ? { ...v, value } : v));
    let sc = await this.scenarios.create(finance, id, {
      title: 'متحفظ: انخفاض التبرعات 20%', description: 'تراجع التبرعات مع علاوة أقل وتأجيل التعيين الممول ذاتيًا',
      levers: [{ name: 'انخفاض الإيرادات', type: 'pct', value: -20, fromMonth: 1, scope: { sections: ['revenue'] }, note: 'تراجع متوقع في التبرعات العامة' }],
    });
    await this.scenarios.create(finance, id, {
      title: 'توسعي: نمو الإيرادات', description: 'نمو الإيرادات 10% مع ارتفاع أسعار التشغيل من يوليو',
      levers: [
        { name: 'نمو الإيرادات', type: 'pct', value: 10, fromMonth: 1, scope: { sections: ['revenue'] }, note: null },
        { name: 'ارتفاع أسعار الخدمات والعقود', type: 'pct', value: 5, fromMonth: 7, scope: { sections: ['opex'] }, note: 'تجديد العقود في يوليو' },
      ],
    });
    await this.scenarios.create(finance, id, {
      title: 'تأجيل الأنشطة والمشاريع 3 أشهر', description: 'تأخر وصول التمويل المقيد',
      levers: [{ name: 'تأجيل الأنشطة', type: 'shift', value: 3, fromMonth: 1, scope: { sections: ['activity'] }, note: 'ما يتجاوز ديسمبر ينتقل للسنة التالية' }],
    });
    sc = await this.budgets.update(finance, sc.id, { variables: setVar(sc, 'general_raise', 3) });
    const own = (sc.lines as L[]).find((l) => l.kind === 'new_position' && l.name.includes('تنمية موارد'));
    if (own) await this.budgets.updateLine(finance, own.id, { included: false, note: 'تأجيل التعيين في السيناريو المتحفظ' });

    return { budget: id };
  }
}
