import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Organization, User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { accessProblem } from '../organizations/org-access';
import { companySlug } from '../company';
import { deletionNotice, loginDeletionText } from '../lifecycle/lifecycle-rules';
import { AuthUser } from './decorators';
import { PasswordResetService } from './password-reset.service';
import { PermissionResolver } from './permission-resolver.service';

// يستخدم عند عدم وجود المستخدم حتى يأخذ الرفض نفس الوقت تقريبًا
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    private readonly jwt: JwtService,
    private readonly resolver: PermissionResolver,
    private readonly catalog: ModuleCatalogService,
    private readonly resets: PasswordResetService,
  ) {}

  /**
   * الدخول بالبريد الإلكتروني أو باسم المستخدم.
   * كل جمعية لها صفحة دخول خاصة (organization = slug)، وموظفوها يدخلون منها فقط.
   * الدخول بدون جمعية لمدير المنصة فقط.
   */
  async login(login: string, password: string, orgSlug?: string) {
    const fail = () => new UnauthorizedException('بيانات الدخول أو كلمة المرور غير صحيحة');
    // وضع الشركة الواحدة: الدخول بلا رابط منشأة يعني منشأة الشركة
    const slug = orgSlug || companySlug() || undefined;
    const org = slug ? await this.findOrg(slug) : null;
    if (slug && !org) throw new UnauthorizedException('رابط الجمعية غير صحيح');
    const id = login.trim().toLowerCase();
    const user = await this.users.findOne({
      where: id.includes('@') ? { email: id } : { username: id },
      select: { id: true, passwordHash: true, organizationId: true, isPlatformAdmin: true, mustChangePassword: true, tempPasswordExpiresAt: true },
    });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw fail();
    if (org && !(user.isPlatformAdmin && !orgSlug)) {
      if (user.organizationId !== org.id) throw fail();
    } else if (!user.isPlatformAdmin) {
      // كلمة المرور صحيحة، فنوجّهه لصفحة جمعيته
      const own = user.organizationId ? await this.orgs.findOne({ where: { id: user.organizationId } }) : null;
      throw new UnauthorizedException(
        own ? `هذا حساب موظف في "${own.name}". ادخل من صفحة جمعيتك: /o/${own.slug}` : 'بيانات الدخول أو كلمة المرور غير صحيحة',
      );
    }
    // كلمة المرور المؤقتة صالحة 24 ساعة فقط
    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('انتهت صلاحية كلمة المرور المؤقتة. اطلب كلمة جديدة من «نسيت كلمة المرور؟»');
    }
    // الجمعية الموقوفة أو المنتهي اشتراكها: رسالة توضح السبب
    const problem = org ? accessProblem(org) : null;
    if (problem) {
      // إن كان للجمعية موعد حذف (انتهاء التجربة أو إنهاء بالتراضي) توضح الرسالة موعده
      const notice = await deletionNotice(this.users.manager, org!);
      throw new UnauthorizedException(notice && notice.reason !== 'trial' ? loginDeletionText(notice) : problem);
    }
    // يتحقق من أن الحساب والجمعية نشطان
    if (!(await this.resolver.resolve(user.id))) {
      throw new UnauthorizedException('الحساب أو الجمعية موقوف، تواصل مع الإدارة');
    }
    await this.users.update(user.id, { lastLoginAt: new Date() });
    // ts بالملي ثانية: يميّز الجلسات التي سبقت إصدار كلمة مؤقتة ولو في نفس الثانية
    const accessToken = await this.jwt.signAsync({ sub: user.id, ts: Date.now() });
    return { accessToken, ...(await this.session(user.id)) };
  }

  async organizationLogin(slug: string) {
    const org = await this.findOrg(slug);
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    return { name: org.name, slug: org.slug };
  }

  private findOrg(slug: string) {
    return this.orgs.findOne({ where: { slug: slug.trim().toLowerCase() } });
  }

  /** بيانات الجلسة: المستخدم + صلاحياته + الوحدات المتاحة له وقوائمها */
  async session(userId: string) {
    const user = (await this.resolver.resolve(userId)) as AuthUser;
    const { allowedScreens, sessionsValidAfter: _v, ...rest } = user;
    return {
      user: rest,
      apps: this.catalog.appsFor(user.permissions, allowedScreens),
      screens: this.catalog.screenAccess(allowedScreens ?? null),
    };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, passwordHash: true, email: true, username: true, mustChangePassword: true },
    });
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }
    if (current === next) {
      throw new BadRequestException('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
    }
    const lower = next.toLowerCase();
    if ([user.username, user.email.split('@')[0]].some((x) => x && x.length >= 3 && lower.includes(x.toLowerCase()))) {
      throw new BadRequestException('لا تجعل اسم الدخول أو البريد جزءًا من كلمة المرور');
    }
    await this.users.update(user.id, { passwordHash: await bcrypt.hash(next, 12), mustChangePassword: false, tempPasswordExpiresAt: null });
    if (user.mustChangePassword) await this.resets.completeForUser(user.id);
  }

  /** «نسيت كلمة المرور»: الرد واحد دائمًا حتى لا يكشف وجود الحساب */
  forgot(login: string, orgSlug: string | undefined, ip: string | null) {
    return this.resets.requestStaff(login, orgSlug, ip);
  }
}
