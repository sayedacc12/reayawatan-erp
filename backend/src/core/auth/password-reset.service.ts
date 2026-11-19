import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { Organization, User } from '../entities';
import { accessProblem } from '../organizations/org-access';
import { AuthUser, OrgUser } from './decorators';
import { PasswordReset, ResetAudience } from './password-reset.entity';

/**
 * قواعد استعادة كلمة المرور (المنصة لا ترسل بريدًا ولا رسائل نصية بعد):
 * - الطلب لا يكشف وجود الحساب: نفس الرد دائمًا، ولا يُسجل شيء لحساب غير موجود.
 * - الطلب يصل لمن يملك صلاحية تسليم كلمة مؤقتة: مدير الجمعية لموظفيها، ومالك المنصة لمديري الجمعيات وفريقه،
 *   وموظفو المساعدات الاجتماعية للمستفيدين (بعد مطابقة رقم الهوية مع الجوال المسجل).
 * - طلب مفتوح واحد لكل حساب، وثلاثة طلبات بحد أقصى في اليوم، إضافة لحد المحاولات لكل عنوان.
 * - كلمة المرور المؤقتة عشوائية، تظهر للمسؤول مرة واحدة، وصالحة 24 ساعة،
 *   ويُلزم صاحبها بتغييرها عند أول دخول، وتُنهى كل جلساته المفتوحة لحظة إصدارها.
 * - كل خطوة مسجلة: من طلب ومتى ومن أي عنوان، ومن سلّم ومتى، ومتى غيّرها صاحبها.
 */
export const TEMP_PASSWORD_HOURS = 24;
const DAILY_REQUESTS = 3;
const PENDING_DAYS = 7;

/** الرد الموحد على «نسيت كلمة المرور» سواء وُجد الحساب أو لا */
export const STAFF_FORGOT_REPLY =
  'استلمنا طلبك. إن كان الحساب مسجلًا لدينا فسيصل الطلب إلى مدير النظام في جهتك، وسيسلّمك كلمة مرور مؤقتة تغيّرها عند أول دخول.';
export const PLATFORM_FORGOT_REPLY =
  'استلمنا طلبك. إن كان الحساب من فريق المنصة فسيصل الطلب إلى مالك المنصة ليسلّمك كلمة مرور مؤقتة.';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
/** كلمة مرور مؤقتة سهلة القراءة (بلا أحرف متشابهة مثل O و0 و l و1) */
export function generateTempPassword() {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  // تبدأ بحرف وتحتوي رقمًا مضمونًا
  return `Tmp-${pick(4)}${randomInt(2, 10)}-${pick(4)}`;
}

export const tempExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000);

@Injectable()
export class PasswordResetService {
  constructor(private readonly db: DataSource) {}

  private get repo() {
    return this.db.getRepository(PasswordReset);
  }

  /**
   * يسجل طلب استعادة لحساب موجود، مع منع التكرار: طلب مفتوح واحد وثلاثة في اليوم.
   * لا يرمي أخطاء أبدًا حتى يبقى الرد على الزائر واحدًا.
   */
  async record(p: { audience: ResetAudience; organizationId: string | null; userId?: string; beneficiaryId?: string; name: string; ip: string | null }) {
    const mine = () => this.repo.createQueryBuilder('r')
      .where(p.userId ? 'r.user_id = :id' : 'r.beneficiary_id = :id', { id: p.userId ?? p.beneficiaryId });
    const [open, today] = await Promise.all([
      mine().andWhere(`r.status = 'pending'`).andWhere('r.created_at > :since', { since: new Date(Date.now() - PENDING_DAYS * 86400_000) }).getCount(),
      mine().andWhere(`r.origin = 'request'`).andWhere('r.created_at > :since', { since: new Date(Date.now() - 86400_000) }).getCount(),
    ]);
    if (open || today >= DAILY_REQUESTS) return;
    await this.repo.save(this.repo.create({
      organizationId: p.organizationId, audience: p.audience, userId: p.userId ?? null, beneficiaryId: p.beneficiaryId ?? null,
      subjectName: p.name.slice(0, 200), origin: 'request', status: 'pending', requestIp: p.ip?.slice(0, 64) ?? null,
    }));
  }

  // ---------------- الموظفون وفريق المنصة ----------------

  /** «نسيت كلمة المرور» من صفحة دخول جمعية (orgSlug) أو من صفحة دخول المنصة */
  async requestStaff(login: string, orgSlug: string | undefined, ip: string | null) {
    const reply = { message: orgSlug ? STAFF_FORGOT_REPLY : PLATFORM_FORGOT_REPLY };
    const id = login.trim().toLowerCase();
    if (!id) return reply;
    const users = this.db.getRepository(User);
    const user = await users.findOne({ where: id.includes('@') ? { email: id } : { username: id } });
    if (!user || !user.isActive) return reply;
    if (orgSlug) {
      const org = await this.db.getRepository(Organization).findOne({ where: { slug: orgSlug.trim().toLowerCase() } });
      if (!org || user.organizationId !== org.id || accessProblem(org)) return reply;
      await this.record({ audience: 'staff', organizationId: org.id, userId: user.id, name: user.fullName, ip });
    } else if (user.isPlatformAdmin && user.platformRole) {
      // عضو فريق المنصة: يسلّمه مالك المنصة. مالك المنصة نفسه يستعيد حسابه من الخادم
      await this.record({ audience: 'platform', organizationId: null, userId: user.id, name: user.fullName, ip });
    }
    return reply;
  }

  /** يضبط كلمة مرور مؤقتة لحساب موظف ويغلق طلباته المفتوحة ويسجل العملية */
  async issueForUser(userId: string, issuedBy: string, em: EntityManager = this.db.manager) {
    const user = await em.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    if (!user.isActive) throw new BadRequestException('الحساب موقوف، فعّله أولًا ثم أصدر كلمة المرور المؤقتة');
    const password = generateTempPassword();
    const expiresAt = tempExpiry();
    const now = new Date();
    await em.getRepository(User).update(user.id, {
      passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, tempPasswordExpiresAt: expiresAt, sessionsValidAfter: now,
    });
    const audience: ResetAudience = user.isPlatformAdmin ? 'platform' : 'staff';
    await this.markIssued(em, { userId: user.id }, { audience, organizationId: user.organizationId, name: user.fullName }, issuedBy, expiresAt);
    return { password, login: user.username ?? user.email, fullName: user.fullName, expiresAt };
  }

  /** بعد أن يختار صاحب الحساب كلمة مروره الجديدة */
  async completeForUser(userId: string, em: EntityManager = this.db.manager) {
    await em.getRepository(PasswordReset).update({ userId, status: 'issued' }, { status: 'completed', completedAt: new Date() });
  }

  /** كلمة مؤقتة يصدرها مسؤول المستخدمين في الجمعية لأحد موظفيها */
  async issueByOrg(actor: OrgUser, userId: string) {
    const user = await this.db.getRepository(User).findOne({ where: { id: userId, organizationId: actor.organizationId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    if (user.id === actor.id) throw new BadRequestException('لا تصدر كلمة مؤقتة لحسابك. غيّر كلمة مرورك من صفحة «حسابي»');
    if (user.isSuperadmin && !actor.isSuperadmin) throw new ForbiddenException('فقط مدير النظام يصدر كلمة مؤقتة لمدير نظام');
    return this.issueForUser(user.id, actor.fullName);
  }

  /** طلبات موظفي الجمعية المفتوحة وسجل آخر العمليات (لشاشة المستخدمين) */
  async orgOverview(actor: OrgUser) {
    const rows = await this.repo.find({
      where: { organizationId: actor.organizationId, audience: 'staff' },
      order: { createdAt: 'DESC' }, take: 60,
    });
    const admins = new Set((await this.db.getRepository(User).find({
      where: { organizationId: actor.organizationId, isSuperadmin: true }, select: { id: true },
    })).map((u) => u.id));
    const present = rows.map((r) => this.present(r, { superadmin: !!r.userId && admins.has(r.userId) }));
    return { pending: present.filter((r) => r.status === 'pending'), log: present.slice(0, 40) };
  }

  /** طلبات تصل لمالك المنصة: مديرو أنظمة الجمعيات وأعضاء فريق المنصة */
  async platformOverview() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await this.db.query(
      `SELECT r.*, o.name AS org_name, o.slug AS org_slug, u.is_superadmin AS superadmin FROM password_resets r
         JOIN users u ON u.id = r.user_id LEFT JOIN organizations o ON o.id = r.organization_id
        WHERE r.audience = 'platform' OR (r.audience = 'staff' AND u.is_superadmin)
        ORDER BY r.created_at DESC LIMIT 80`,
    );
    const present = rows.map((r) => ({
      ...this.present(this.repo.create({
        id: r.id, organizationId: r.organization_id, audience: r.audience, userId: r.user_id, subjectName: r.subject_name, origin: r.origin,
        status: r.status, requestIp: r.request_ip, issuedAt: r.issued_at, issuedBy: r.issued_by, expiresAt: r.expires_at,
        completedAt: r.completed_at, createdAt: r.created_at,
      }), { superadmin: r.superadmin }),
      organizationName: r.org_name as string | null,
      organizationSlug: r.org_slug as string | null,
    }));
    return { pending: present.filter((r) => r.status === 'pending'), log: present.slice(0, 40) };
  }

  /** مالك المنصة يصدر كلمة مؤقتة من طلب وصله */
  async issueByPlatform(actor: AuthUser, requestId: string) {
    if (actor.organizationId || !actor.isPlatformAdmin) throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
    const row = await this.repo.findOne({ where: { id: requestId, userId: Not(IsNull()) } });
    if (!row?.userId) throw new NotFoundException('الطلب غير موجود');
    const user = await this.db.getRepository(User).findOne({ where: { id: row.userId } });
    if (!user || (!user.isSuperadmin && !(user.isPlatformAdmin && user.platformRole))) throw new ForbiddenException('هذا الحساب يستعيده مدير نظام جمعيته');
    return this.issueForUser(user.id, `${actor.fullName} (إدارة المنصة)`);
  }

  // ---------------- مستفيدو البوابة ----------------

  /** يسجل إصدار كلمة مؤقتة لمستفيد (تضبطها وحدة المساعدات الاجتماعية) */
  async issuedForBeneficiary(em: EntityManager, p: { organizationId: string; beneficiaryId: string; name: string }, issuedBy: string, expiresAt: Date) {
    await this.markIssued(em, { beneficiaryId: p.beneficiaryId }, { audience: 'portal', organizationId: p.organizationId, name: p.name }, issuedBy, expiresAt);
  }

  async completeForBeneficiary(beneficiaryId: string) {
    await this.repo.update({ beneficiaryId, status: 'issued' }, { status: 'completed', completedAt: new Date() });
  }

  /** طلبات مستفيدي البوابة المفتوحة في الجمعية */
  pendingPortal(organizationId: string, beneficiaryIds?: string[]) {
    return this.repo.find({
      where: {
        organizationId, audience: 'portal', status: 'pending',
        ...(beneficiaryIds ? { beneficiaryId: In(beneficiaryIds) } : {}),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async portalLog(organizationId: string, beneficiaryId: string) {
    const rows = await this.repo.find({ where: { organizationId, beneficiaryId }, order: { createdAt: 'DESC' }, take: 10 });
    return rows.map((r) => this.present(r));
  }

  // ---------------- مشترك ----------------

  private async markIssued(
    em: EntityManager, who: { userId: string } | { beneficiaryId: string },
    subject: { audience: ResetAudience; organizationId: string | null; name: string }, issuedBy: string, expiresAt: Date,
  ) {
    const repo = em.getRepository(PasswordReset);
    const now = new Date();
    // الكلمة المؤقتة السابقة لم تعد صالحة
    await repo.update({ ...who, status: 'issued' }, { status: 'cancelled' });
    const res = await repo.update({ ...who, status: 'pending' }, { status: 'issued', issuedAt: now, issuedBy, expiresAt });
    if (!res.affected) {
      await repo.save(repo.create({
        ...('userId' in who ? { userId: who.userId } : { beneficiaryId: who.beneficiaryId }),
        organizationId: subject.organizationId, audience: subject.audience, subjectName: subject.name.slice(0, 200),
        origin: 'direct', status: 'issued', issuedAt: now, issuedBy, expiresAt,
      }));
    }
  }

  private present(r: PasswordReset, extra: { superadmin?: boolean } = {}) {
    const stale = r.status === 'pending' && Date.now() - new Date(r.createdAt).getTime() > PENDING_DAYS * 86400_000;
    const expired = r.status === 'issued' && !!r.expiresAt && new Date(r.expiresAt).getTime() < Date.now();
    return {
      id: r.id, userId: r.userId, beneficiaryId: r.beneficiaryId, name: r.subjectName, origin: r.origin, channel: r.channel,
      status: stale || expired ? ('expired' as const) : r.status, requestIp: r.requestIp, createdAt: r.createdAt,
      issuedAt: r.issuedAt, issuedBy: r.issuedBy, expiresAt: r.expiresAt, completedAt: r.completedAt, superadmin: !!extra.superadmin,
    };
  }
}
