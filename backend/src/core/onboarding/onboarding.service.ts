import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { UserOnboarding } from './onboarding.entity';

/** خطوة من خطوات إطلاق الشركة. تُكتشف تلقائيًا من بيانات الشركة، ويمكن تعليمها يدويًا */
interface StepDef {
  key: string;
  phase: string;
  title: string;
  hint: string;
  /** الشاشة التي تبدأ منها الخطوة */
  link: string;
  /** النظام الذي تتبعه الخطوة (تُخفى إن لم يكن متاحًا للشركة) */
  app: string;
  /** استعلام يعيد صفًا واحدًا فيه done (منطقي). بدونه تُعلَّم الخطوة يدويًا فقط */
  sql?: string;
  /** يُمرَّر للاستعلام: الشركة، أو الشركة والمستخدم */
  withUser?: boolean;
}

const exists = (table: string, extra = '') => `SELECT EXISTS (SELECT 1 FROM "${table}" WHERE organization_id = $1 ${extra}) AS done`;

export const LAUNCH_PHASES = [
  { key: 'foundation', title: 'التأسيس', icon: '🏛️', hint: 'هوية الشركة وفريق العمل والصلاحيات' },
  { key: 'team', title: 'الفريق والهيكل', icon: '👥', hint: 'الهيكل التنظيمي وملفات الموظفين' },
  { key: 'finance', title: 'المالية', icon: '💰', hint: 'دليل الحسابات والسنة المالية والبنوك' },
  { key: 'services', title: 'الخدمات', icon: '🤝', hint: 'برامج المساعدات والداعمون' },
  { key: 'launch', title: 'الانطلاق', icon: '🚀', hint: 'الموقع الإلكتروني' },
] as const;

const STEPS: StepDef[] = [
  { key: 'identity', phase: 'foundation', app: 'core', title: 'أكمل هوية الشركة', hint: 'ارفع الشعار واكتب الرؤية والرسالة، لتظهر في النظام والتقارير والموقع.', link: '/settings/identity', sql: `SELECT EXISTS (SELECT 1 FROM org_identity WHERE organization_id = $1 AND logo IS NOT NULL) AS done` },
  { key: 'roles', phase: 'foundation', app: 'core', title: 'حدد الأدوار والصلاحيات', hint: 'أنشئ أدوارًا مثل «محاسب» و«باحث اجتماعي»، واختر لكل دور ما يراه وما يعدّله.', link: '/settings/roles', sql: exists('roles') },
  { key: 'users', phase: 'foundation', app: 'core', title: 'أضف فريق العمل', hint: 'أنشئ حسابات الدخول لزملائك وامنح كل واحد منهم دوره المناسب.', link: '/settings/users', sql: `SELECT (SELECT count(*) FROM users WHERE organization_id = $1) > 1 AS done` },
  { key: 'structure', phase: 'team', app: 'hr', title: 'ابنِ الهيكل التنظيمي', hint: 'أضف الإدارات والأقسام، وحدد مدير كل وحدة.', link: '/hr/structure', sql: exists('hr_units') },
  { key: 'employees', phase: 'team', app: 'hr', title: 'سجّل ملفات الموظفين', hint: 'أضف الموظفين ببياناتهم الوظيفية ورواتبهم، ليستفيدوا من الخدمة الذاتية.', link: '/hr/employees', sql: exists('hr_employees') },
  { key: 'link-me', phase: 'team', app: 'hr', title: 'اربط حسابك بملفك الوظيفي', hint: 'من ملف موظفك اختر حسابك في خانة «حساب الدخول»، لتظهر لك لوحتك الشخصية كاملة.', link: '/hr/employees', sql: exists('hr_employees', 'AND user_id = $2'), withUser: true },
  { key: 'chart', phase: 'finance', app: 'accounting', title: 'ثبّت دليل الحسابات', hint: 'ثبّت الدليل المحاسبي الموحد للقطاع غير الربحي بضغطة واحدة، أو أضف حساباتك.', link: '/accounting/accounts', sql: exists('acc_accounts') },
  { key: 'fiscal-year', phase: 'finance', app: 'accounting', title: 'افتح السنة المالية', hint: 'أنشئ السنة المالية الحالية وأدخل الأرصدة الافتتاحية.', link: '/accounting/setup', sql: exists('acc_fiscal_years') },
  { key: 'banks', phase: 'finance', app: 'accounting', title: 'أضف البنوك والصناديق', hint: 'سجّل حسابات الشركة البنكية والصناديق النقدية لتستخدمها في السندات.', link: '/accounting/banks', sql: exists('acc_cash_accounts') },
  { key: 'programs', phase: 'services', app: 'beneficiaries', title: 'عرّف برامج المساعدات', hint: 'أضف البرامج والمساعدات التي تقدمها الشركة ومسارات اعتماد طلباتها.', link: '/beneficiaries/settings', sql: exists('activities') },
  { key: 'donors', phase: 'services', app: 'fundraising', title: 'سجّل الداعمين', hint: 'أضف الداعمين والمانحين لتتابع فرص الدعم والتعهدات.', link: '/fundraising/donors', sql: exists('fundraising_donors') },
  { key: 'website', phase: 'launch', app: 'website', title: 'انشر موقع الشركة', hint: 'راجع صفحات الموقع ثم فعّل النشر ليصل إليه الزوار والمتبرعون.', link: '/website/settings', sql: `SELECT EXISTS (SELECT 1 FROM web_settings WHERE organization_id = $1 AND published) AS done` },
];

@Injectable()
export class OnboardingService {
  private readonly log = new Logger('Onboarding');

  constructor(
    @InjectRepository(UserOnboarding) private readonly repo: Repository<UserOnboarding>,
    private readonly db: DataSource,
  ) {}

  private async row(userId: string) {
    return (await this.repo.findOne({ where: { userId } })) ?? this.repo.create({ userId, marks: {}, celebrated: [], launchHidden: false, welcomeSeenAt: null, tourDoneAt: null });
  }

  async state(user: AuthUser) {
    const r = await this.row(user.id);
    // خطوات الإطلاق لمدير نظام الشركة فقط؛ باقي الموظفين لهم الترحيب والجولة
    const launch = user.organizationId && user.isSuperadmin ? await this.launch(user.organizationId, user.id, r.marks) : null;
    return {
      welcomeSeen: !!r.welcomeSeenAt,
      tourDone: !!r.tourDoneAt,
      launchHidden: r.launchHidden,
      celebrated: r.celebrated,
      launch,
    };
  }

  private async launch(orgId: string, userId: string, marks: Record<string, string>) {
    const steps = await Promise.all(STEPS.map(async (s) => {
      let auto = false;
      if (s.sql) {
        try {
          const [res] = await this.db.query(s.sql, s.withUser ? [orgId, userId] : [orgId]);
          auto = !!res?.done;
        } catch (e) {
          // تعطل فحص خطوة لا يوقف بقية القائمة
          this.log.warn(`Launch step ${s.key} check failed: ${(e as Error).message}`);
        }
      }
      const mark = marks[s.key] ?? null;
      const { sql: _sql, withUser: _w, ...rest } = s;
      return { ...rest, auto: !!s.sql, done: auto || mark === 'done', skipped: !auto && mark === 'skipped' };
    }));
    return { phases: LAUNCH_PHASES, steps };
  }

  async update(user: AuthUser, dto: { welcomeSeen?: boolean; tourDone?: boolean; launchHidden?: boolean; mark?: { key: string; status: 'done' | 'skipped' | null }; celebrate?: string[] }) {
    const r = await this.row(user.id);
    if (dto.welcomeSeen !== undefined) r.welcomeSeenAt = dto.welcomeSeen ? (r.welcomeSeenAt ?? new Date()) : null;
    if (dto.tourDone !== undefined) r.tourDoneAt = dto.tourDone ? (r.tourDoneAt ?? new Date()) : null;
    if (dto.launchHidden !== undefined) r.launchHidden = dto.launchHidden;
    if (dto.mark && STEPS.some((s) => s.key === dto.mark!.key)) {
      const marks = { ...r.marks };
      if (dto.mark.status) marks[dto.mark.key] = dto.mark.status;
      else delete marks[dto.mark.key];
      r.marks = marks;
    }
    if (dto.celebrate?.length) r.celebrated = [...new Set([...r.celebrated, ...dto.celebrate])].slice(0, 100);
    await this.repo.save(r);
    return this.state(user);
  }

  /** إعادة التعريف من البداية: الترحيب والجولة (تبقى الخطوات المنجزة كما هي) */
  async replay(user: AuthUser) {
    const r = await this.row(user.id);
    r.welcomeSeenAt = null;
    r.tourDoneAt = null;
    r.launchHidden = false;
    await this.repo.save(r);
    return this.state(user);
  }
}
