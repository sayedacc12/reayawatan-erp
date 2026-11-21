import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../core/auth/decorators';
import { User } from '../../core/entities';
import { SupportDeskService } from '../../core/support/support-desk.service';
import { PLATFORM_ROLE_PERMISSIONS, PlatformRole } from '../../core/support/support.manifest';
import { SupportService } from '../../core/support/support.service';
import { DEMO_EMAIL, DemoTeam } from './demo-context';

/**
 * الدعم الفني: فريق دعم تجريبي (مدير دعم وموظف دعم) بحسابات منصة، وطلبات صيانة من الشركة التجريبية بكل الحالات
 * (جديد، قيد المعالجة، بانتظار رد الشركة، محلول، مغلق بتقييم)، ومهام وتكليفات منجزة وجارية ومتأخرة بساعات عمل مسجلة.
 */
@Injectable()
export class SupportSeed {
  constructor(
    private readonly db: DataSource,
    private readonly tickets: SupportService,
    private readonly desk: SupportDeskService,
  ) {}

  /** عضو فريق الدعم: يُنشأ مرة واحدة، وتُحدَّث كلمة مروره مع كل إعادة إنشاء للشركة التجريبية */
  private async member(name: string, fullName: string, role: PlatformRole, password: string): Promise<AuthUser> {
    const repo = this.db.getRepository(User);
    const email = DEMO_EMAIL(name);
    const passwordHash = await bcrypt.hash(password, 10);
    let u = await repo.findOne({ where: { email } });
    if (u) await repo.update({ id: u.id }, { passwordHash, isActive: true, platformRole: role, fullName });
    else u = await repo.save(repo.create({ fullName, email, passwordHash, isPlatformAdmin: true, organizationId: null, platformRole: role, isActive: true }));
    return {
      id: u.id, organizationId: null, organizationName: null, organizationSlug: null, email, username: null, fullName,
      isSuperadmin: false, isPlatformAdmin: true, permissions: PLATFORM_ROLE_PERMISSIONS[role],
    };
  }

  async run(team: DemoTeam, password: string) {
    const manager = await this.member('support-manager', 'هند العمري (مدير الدعم)', 'support_manager', password);
    const agent = await this.member('support-agent', 'ياسر الشهري (موظف دعم)', 'support_agent', password);
    const { admin, finance } = team;

    // 1) طلب جديد لم يُسند بعد
    await this.tickets.create(finance, {
      subject: 'استفسار عن إغلاق شهر فيه سند صرف لم يُعتمد', category: 'question', priority: 'normal', screen: 'النظام المالي · إغلاق الفترات',
      description: 'حاولنا إغلاق الشهر الماضي فظهرت رسالة بوجود سند صرف لم يكتمل اعتماده. هل نلغيه أم ننتظر اعتماده؟',
    });

    // 2) قيد المعالجة: أسنده المدير لموظف الدعم، ومعه مهمة جارية بساعات مسجلة
    const t2 = await this.tickets.create(admin, {
      subject: 'تعذر رفع إيصال المساهمة من بوابة المستفيدين', category: 'malfunction', priority: 'critical', screen: 'بوابة المستفيدين',
      description: 'إحدى المستفيدات أبلغت أن رفع صورة الإيصال يتوقف عند 90% ثم يظهر خطأ، والملف حجمه 3 ميجا تقريبًا.',
    });
    await this.tickets.platformUpdate(manager, t2.id, { assigneeId: agent.id });
    await this.tickets.platformReply(agent, t2.id, { body: 'وصلنا البلاغ ونعمل عليه الآن. هل يمكن تزويدنا بنوع الجهاز والمتصفح؟' });
    const task2 = await this.desk.createTask(manager, {
      ticketId: t2.id, assigneeId: agent.id, title: 'فحص رفع الملفات الكبيرة في البوابة', description: 'تجربة الرفع من الجوال بملفات 2-5 ميجا ومراجعة سجل الأخطاء', estimatedHours: 4,
    });
    await this.desk.logHours(agent, task2.id, { hours: 1.5, note: 'أُعيد إنتاج المشكلة من متصفح الجوال' });

    // 3) بانتظار رد الشركة
    const t3 = await this.tickets.create(admin, {
      subject: 'إضافة صلاحية اعتماد سندات القبض لموظف جديد', category: 'access', priority: 'medium',
      description: 'نريد إعطاء المحاسب الجديد صلاحية المرحلة الأولى في اعتماد سندات القبض فقط دون الصرف.',
    });
    await this.tickets.platformUpdate(manager, t3.id, { assigneeId: manager.id });
    await this.tickets.platformReply(manager, t3.id, {
      body: 'يمكن ذلك من الإعدادات > مراحل اعتماد القبض بربط المرحلة بدور المحاسب. هل تريدون أن نشرح لكم الخطوات في اتصال قصير؟', status: 'waiting_customer',
    });

    // 4) محلول ثم مغلق بتقييم الشركة، ومهمته منجزة
    const t4 = await this.tickets.create(finance, {
      subject: 'ميزان المراجعة لا يظهر الحسابات الفرعية', category: 'data', priority: 'medium', screen: 'النظام المالي · التقارير',
      description: 'عند عرض ميزان المراجعة يظهر المستوى الأول فقط، ونحتاج كل المستويات حتى الحسابات الفرعية.',
    });
    await this.tickets.platformUpdate(manager, t4.id, { assigneeId: agent.id });
    const task4 = await this.desk.createTask(manager, { ticketId: t4.id, assigneeId: agent.id, title: 'شرح خيار «حتى المستوى» في ميزان المراجعة', estimatedHours: 1 });
    await this.desk.logHours(agent, task4.id, { hours: 0.5, note: 'اتصال مع المحاسب' });
    await this.desk.updateTask(agent, task4.id, { status: 'done', note: 'اختار المحاسب «كل المستويات» وظهرت الحسابات الفرعية' });
    await this.tickets.platformReply(agent, t4.id, { body: 'اختر «كل المستويات» من قائمة «حتى المستوى» ثم اضغط عرض. سعدنا بخدمتكم.', status: 'resolved' });
    await this.tickets.close(finance, t4.id, { rating: 5, note: 'شكرًا على سرعة الحل' });

    // 5) مهمة داخلية متأخرة عن موعدها (بدون طلب) لتظهر في تقييم الأداء
    const late = await this.desk.createTask(manager, {
      assigneeId: agent.id, title: 'تحديث دليل استخدام النظام المالي', description: 'إضافة شرح شاشتي الترحيل وإغلاق الفترات', priority: 'low',
      dueAt: new Date(Date.now() - 2 * 86400000).toISOString(), estimatedHours: 6,
    });
    await this.desk.logHours(agent, late.id, { hours: 2, note: 'كُتب قسم الترحيل' });

    return [
      { role: 'مدير الدعم الفني', email: manager.email },
      { role: 'موظف الدعم الفني', email: agent.email },
    ];
  }
}
