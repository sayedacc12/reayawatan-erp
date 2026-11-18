import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Permission, Role } from '../../core/entities';
import { COMMS_PERMISSIONS as C } from '../comms/comms.manifest';
import { CommsCore } from '../comms/comms-core.service';
import { TasksService } from '../comms/tasks.service';
import { TransactionsService } from '../comms/transactions.service';
import { MEETINGS_PERMISSIONS as M } from '../meetings/meetings.manifest';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/** فريق الجمعية التجريبية بصلاحيات الاتصالات الإدارية والاجتماعات */
export interface CommsTeam {
  admin: OrgUser; finance: OrgUser; caseManager: OrgUser; researcher: OrgUser; quality: OrgUser; fundraiser: OrgUser; projectsManager: OrgUser;
}

/**
 * الاتصالات الإدارية في الجمعية التجريبية: معاملات إدارية ومالية بكل درجات السرية وفي كل الحالات
 * (عند جهة، متأخرة، معادة، محفوظة، منتهية بسند صرف في النظام المالي)، قرار وتعميم بنسب اطلاع مختلفة،
 * ومهام بمسؤولين ومساندين (منجزة، متأخرة، ممددة، ومن معاملة).
 */
@Injectable()
export class CommsSeed {
  constructor(
    private readonly db: DataSource,
    private readonly core: CommsCore,
    private readonly txns: TransactionsService,
    private readonly tasks: TasksService,
  ) {}

  /** يضيف صلاحيات النظامين لأدوار الفريق ويعيد الفريق بصلاحياته الجديدة */
  async grant(team: DemoTeam): Promise<CommsTeam> {
    const base = [C.read, C.create, M.read];
    const extra: Record<keyof DemoTeam['roles'], string[]> = {
      finance: [C.registry, C.registryMedium, C.financial, C.tasks, C.reports, M.board, M.committees, M.reports],
      caseManager: [C.tasks, C.registry, M.teams, M.teamsManage, M.committees],
      projectsManager: [C.tasks, M.committees],
      quality: [C.reports, M.committees, M.reports, M.teams],
      fundraiser: [M.ga],
      researcher: [M.teams],
    };
    const out: Partial<CommsTeam> = { admin: team.admin };
    for (const [key, id] of Object.entries(team.roles) as [keyof DemoTeam['roles'], string][]) {
      const codes = [...base, ...extra[key]];
      const role = await this.db.getRepository(Role).findOneOrFail({ where: { id }, relations: { permissions: true } });
      role.permissions = [...role.permissions, ...(await this.db.getRepository(Permission).find({ where: { code: In(codes) } }))];
      await this.db.getRepository(Role).save(role);
      out[key] = { ...team[key], permissions: [...team[key].permissions, ...codes] };
    }
    return out as CommsTeam;
  }

  async run(t: CommsTeam) {
    const org = t.admin.organizationId;
    await this.core.settings(org);
    const unit = async (name: string) => ((await this.db.query('SELECT id FROM hr_units WHERE organization_id = $1 AND name = $2', [org, name]))[0]?.id ?? null) as string | null;
    const base = { direction: 'internal' as const, confidentiality: 'normal' as const, priority: 'normal' as const, kind: 'admin' as const, docType: 'transaction' as const };

    // ---- معاملة مالية: طلب صرف من مدير المشاريع إلى المدير المالي، تنتهي بسند صرف (مسودة) في النظام المالي
    const pay = await this.txns.create(t.projectsManager, {
      ...base, kind: 'financial', categoryCode: 'purchase', financialType: 'payment', amount: 4800, partyName: 'مؤسسة البركة للمواد الغذائية',
      subject: 'طلب صرف قيمة سلال غذائية إضافية لمشروع سلة رمضان', body: 'نرفق عرض السعر المعتمد من لجنة المشتريات لتوريد 40 سلة إضافية للأسر المسجلة حديثًا.\nالمطلوب: صرف القيمة حسب الإجراءات.',
      toUserId: t.caseManager.id, purpose: 'approve', note: 'للاعتماد قبل الإحالة للمالية',
    });
    await this.txns.refer(t.caseManager, pay.id, { toUserId: t.finance.id, purpose: 'action', note: 'معتمد من إدارة البرامج، نأمل الصرف', dueDate: daysAhead(3) });
    await this.txns.setFollowers(t.finance, pay.id, [t.fundraiser.id]);
    const [cash] = await this.db.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 ORDER BY (name LIKE 'مصرف الراجحي%') DESC, name LIMIT 1`, [org]);
    const [counter] = await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND code = '4210200401'`, [org]);
    const [cc] = await this.db.query(`SELECT id FROM acc_analytic_accounts WHERE organization_id = $1 AND code = 'CC02'`, [org]);
    if (cash && counter) {
      await this.txns.close(t.finance, pay.id, {
        closeKind: 'voucher', cashAccountId: cash.id, counterAccountId: counter.id, method: 'transfer', methodRef: 'INV-RM-0402', note: 'أُنشئ سند الصرف ويمر بمراحل اعتماده',
        analytic: cc ? [{ analyticId: cc.id, percent: 100 }] : [],
      });
    }

    // ---- معاملة مالية جارية عند المدير المالي: تسوية عهدة
    const custody = await this.txns.create(t.researcher, {
      ...base, kind: 'financial', categoryCode: 'custody', financialType: 'payment', amount: 650, partyName: t.researcher.fullName,
      subject: 'تسوية عهدة الزيارات الميدانية لشهر الماضي', body: 'مرفق كشف المصروفات والفواتير لتسوية العهدة المستديمة.', toUserId: t.caseManager.id, purpose: 'approve',
    });
    await this.txns.refer(t.caseManager, custody.id, { toUserId: t.finance.id, purpose: 'action', note: 'تمت مراجعة الفواتير', dueDate: daysAhead(5) });

    // ---- معاملة إدارية عند مدير البرامج، والجودة تتابعها دون تدخل
    const visits = await this.txns.create(t.researcher, {
      ...base, categoryCode: 'memo', subject: 'طلب اعتماد جدول الزيارات الميدانية للأسبوع القادم',
      body: 'نرفق جدول الزيارات لعشر حالات جديدة في حي المنسك والموظفين، مع طلب توفير سيارة يومي الأحد والثلاثاء.', toUserId: t.caseManager.id, purpose: 'approve', dueDate: daysAhead(2),
      followerUserIds: [t.quality.id],
    });
    await this.txns.task(t.caseManager, visits.id, { title: 'حجز سيارة الجمعية لزيارات الأحد والثلاثاء', ownerUserId: t.researcher.id, dueDate: daysAhead(2) });

    // ---- خطاب وارد من جهة خارجية: عند قسم الجودة ومتأخر عن موعده
    const incoming = await this.txns.create(t.admin, {
      ...base, direction: 'incoming', externalParty: 'المركز الوطني لتنمية القطاع غير الربحي', externalRef: '47/3/1448', categoryCode: 'external', priority: 'urgent',
      subject: 'طلب تحديث بيانات الحوكمة والإفصاح على المنصة الوطنية', body: 'يطلب المركز تحديث بيانات مجلس الإدارة والقوائم المالية المعتمدة خلال أسبوعين.',
      toUserId: t.quality.id, purpose: 'action', dueDate: daysAgo(2), note: 'يرجى التنسيق مع المالية وإفادتنا',
    });
    await this.txns.note(t.quality, incoming.id, { note: 'تم رفع بيانات المجلس، وننتظر القوائم المالية المعتمدة من المراجع الخارجي.' });

    // ---- معاملة سرية: لا يراها إلا الموجهة لهم (حتى سجل المعاملات لا يعرضها)
    await this.txns.create(t.admin, {
      ...base, confidentiality: 'confidential', categoryCode: 'hr', subject: 'ملاحظة بشأن مخالفة إجراءات الصرف النقدي',
      body: 'بناء على ملاحظة المراجع الداخلي، يرجى التحقق من مستندات ثلاثة سندات صرف نقدي وإفادتي بشكل مباشر.', toUserId: t.finance.id, purpose: 'opinion', dueDate: daysAhead(4),
    });
    // ---- معاملة عالية السرية: بلا متابعين ولا تظهر في أي سجل
    await this.txns.create(t.admin, {
      ...base, confidentiality: 'top_secret', priority: 'very_urgent', categoryCode: 'hr', subject: 'تحقيق إداري في شكوى مقدمة من مستفيدة',
      body: 'تُشكل لجنة تحقيق من مدير البرامج وحده، وتُرفع النتائج للمدير التنفيذي خلال أسبوع.', toUserId: t.caseManager.id, purpose: 'action', dueDate: daysAhead(7),
    });
    // ---- متوسطة السرية: عند تنمية الموارد
    await this.txns.create(t.finance, {
      ...base, confidentiality: 'medium', categoryCode: 'general', subject: 'بيانات الداعمين المتأخرين في سداد الوعود',
      body: 'مرفق كشف الوعود المتأخرة أكثر من 60 يومًا للتواصل مع الداعمين.', toUserId: t.fundraiser.id, purpose: 'action', dueDate: daysAhead(6),
    });

    // ---- معاملة أعيدت ثم حُفظت
    const archived = await this.txns.create(t.fundraiser, {
      ...base, categoryCode: 'general', subject: 'مقترح حملة تبرعات للحقيبة المدرسية', body: 'مقترح حملة رقمية للحقيبة المدرسية بمستهدف 150 ألف ريال.',
      toUserId: t.projectsManager.id, purpose: 'opinion',
    });
    await this.txns.returnBack(t.projectsManager, archived.id, { note: 'المشروع ممول بالكامل هذا العام من منحة، نقترح تأجيل الحملة للعام القادم.' });
    await this.txns.close(t.fundraiser, archived.id, { closeKind: 'archive', note: 'تُحفظ وتُعاد دراستها مع خطة العام القادم' });

    // ---- معاملة منجزة
    const done = await this.txns.create(t.caseManager, {
      ...base, categoryCode: 'memo', subject: 'تحديث قائمة الأسر المستفيدة من كفالة الأيتام', body: 'نرجو تحديث القائمة بعد اعتماد الحالات الجديدة.', toUserId: t.projectsManager.id, purpose: 'action',
    });
    await this.txns.close(t.projectsManager, done.id, { closeKind: 'done', note: 'حُدثت القائمة وأُبلغ قسم البحث الاجتماعي' });

    // ---- مسودة لم ترسل
    await this.txns.create(t.researcher, { ...base, categoryCode: 'memo', subject: 'مقترح تعديل نموذج البحث الاجتماعي', body: 'مسودة...', draft: true });

    // ---- قرار وتعميم
    const units = (await Promise.all(['إدارة البرامج والخدمات', 'إدارة الشؤون المالية والإدارية', 'إدارة تنمية الموارد', 'قسم الجودة'].map(unit))).filter(Boolean) as string[];
    const decision = await this.txns.create(t.admin, {
      docType: 'decision', kind: 'admin', confidentiality: 'normal', priority: 'normal', subject: 'قرار إداري بتشكيل لجنة المشتريات للعام الحالي',
      body: 'بناء على الصلاحيات المخولة للمدير التنفيذي، تُشكل لجنة المشتريات برئاسة المدير المالي وعضوية مدير المشاريع ومسؤولة الجودة، وتجتمع شهريًا.',
      recipientUserIds: [t.finance.id, t.projectsManager.id, t.quality.id, t.caseManager.id],
    });
    await this.txns.acknowledge(t.finance, decision.id);
    await this.txns.acknowledge(t.projectsManager, decision.id);
    const circular = await this.txns.create(t.admin, {
      docType: 'circular', kind: 'admin', confidentiality: 'normal', priority: 'normal', subject: 'تعميم بشأن الدوام الرسمي وتسجيل البصمة',
      body: 'يُعمم على جميع الموظفين الالتزام بتسجيل البصمة دخولًا وخروجًا، والدوام الرسمي من الساعة 8 صباحًا حتى 4 مساءً.',
      recipientUnitIds: units, recipientUserIds: [t.researcher.id, t.fundraiser.id],
    });
    await this.txns.acknowledge(t.researcher, circular.id);
    await this.txns.acknowledge(t.fundraiser, circular.id);
    await this.txns.acknowledge(t.quality, circular.id);

    // ---- مهام مباشرة: مسؤول واحد، ومساندون يتابعون دون مسؤولية
    const report = await this.tasks.create(t.admin, {
      title: 'إعداد التقرير الربعي لإنجاز المشاريع', description: 'تقرير بالمؤشرات والصور وقصص النجاح للربع الحالي يُعرض على مجلس الإدارة.',
      ownerUserId: t.projectsManager.id, supporterUserIds: [t.fundraiser.id, t.quality.id], priority: 'urgent', dueDate: daysAhead(10),
    });
    await this.tasks.update(t.projectsManager, report.id, { action: 'progress', progress: 40, text: 'جُمعت مؤشرات ثلاثة مشاريع' });
    await this.tasks.update(t.fundraiser, report.id, { action: 'note', text: 'أرسلت قصص النجاح والصور على البريد' });

    const late = await this.tasks.create(t.admin, {
      title: 'تحديث سياسة تعارض المصالح ونشرها على الموقع', ownerUserId: t.quality.id, priority: 'normal', startDate: daysAgo(30), dueDate: daysAgo(3),
    });
    await this.tasks.update(t.quality, late.id, { action: 'progress', progress: 70, text: 'المسودة جاهزة بانتظار رأي المستشار القانوني' });

    const ext = await this.tasks.create(t.admin, { title: 'مطابقة كشوف البنوك للربع الثالث', ownerUserId: t.finance.id, priority: 'normal', startDate: daysAgo(20), dueDate: daysAgo(1) });
    await this.tasks.update(t.admin, ext.id, { action: 'extend', dueDate: daysAhead(7), text: 'تأخر وصول كشف أحد البنوك' });

    const fin = await this.tasks.create(t.caseManager, { title: 'مراجعة ملفات الحالات المتأخرة عن البحث', ownerUserId: t.researcher.id, supporterUserIds: [t.quality.id], priority: 'normal', startDate: daysAgo(14), dueDate: daysAgo(2) });
    await this.tasks.update(t.researcher, fin.id, { action: 'complete', text: 'روجعت 12 حالة واستُكملت مستندات 9 منها' });

    await this.tasks.create(t.admin, { title: 'التحضير لاجتماع الجمعية العمومية السنوي', ownerUserId: t.admin.id, supporterUserIds: [t.finance.id], priority: 'urgent', dueDate: daysAhead(14) });
  }
}
