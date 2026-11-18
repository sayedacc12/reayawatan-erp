import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { TasksService } from '../comms/tasks.service';
import { MtgAgendaItem, MtgAttendee, MtgBody, MtgMeeting, MtgRecommendation } from './entities/meetings.entity';
import { NoteDto, PublicSignDto, SignDto } from './meetings.dto';
import { ATT_AR, KIND_AR, MODE_AR, MeetingsCore, ROLE_AR, SIGN_AR, TYPE_AR, addDays, today } from './meetings-core.service';
import { MeetingsService } from './meetings.service';

const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PRESENT = ['present', 'remote'];
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/** ترتيب ثابت لمفاتيح الكائن حتى تكون البصمة واحدة لنفس المحتوى */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * محضر الاجتماع: يُصدر بنسخة مجمدة لها بصمة SHA-256، ويوقّع الحاضرون عليها إلكترونيًا (بكلمة مرور الحساب لمستخدمي النظام،
 * وبرابط شخصي ورمز تحقق من 6 أرقام للأعضاء من خارجه) أو يمتنعون بسبب مكتوب. ويجوز طباعته وإعادة رفعه موقعًا بالتوقيع الحي.
 * عند اعتماده تتحول التوصيات إلى مهام في نظام المهام، ويمكن لأي أحد التحقق من صحته برمز التحقق.
 */
@Injectable()
export class MinutesService {
  constructor(
    private readonly db: DataSource,
    private readonly core: MeetingsCore,
    private readonly meetings: MeetingsService,
    private readonly files: FileStore,
    private readonly tasks: TasksService,
  ) {}

  private hist(by: string, action: string, note: string | null = null) {
    return { at: new Date().toISOString(), by, action, note };
  }

  /** نص المحضر المجمد: كل ما يوقع عليه الحاضرون */
  private async snapshot(em: EntityManager, m: MtgMeeting, body: MtgBody) {
    const [org] = await em.query('SELECT name FROM organizations WHERE id = $1', [m.organizationId]);
    const attendees = await em.getRepository(MtgAttendee).find({ where: { meetingId: m.id }, order: { sortOrder: 'ASC' } });
    const items = await em.getRepository(MtgAgendaItem).find({ where: { meetingId: m.id }, order: { seq: 'ASC' } });
    const recs = await em.getRepository(MtgRecommendation).find({ where: { meetingId: m.id }, order: { seq: 'ASC' } });
    const voting = attendees.filter((a) => !a.isGuest && a.voting);
    return {
      organization: org?.name ?? '', body: body.name, kind: KIND_AR[m.kind], refNo: m.refNo, title: m.title, type: TYPE_AR[m.meetingType], mode: MODE_AR[m.mode],
      location: m.location, date: m.meetingDate, startTime: m.startTime, endTime: m.endTime, version: m.minutesVersion,
      quorum: { required: body.quorumPercent, voting: voting.length, present: voting.filter((a) => a.attendance && PRESENT.includes(a.attendance)).length, met: m.quorumMet },
      attendees: attendees.map((a) => ({ name: a.name, role: ROLE_AR[a.role], title: a.title, guest: a.isGuest, attendance: a.attendance ? ATT_AR[a.attendance] : ATT_AR.absent })),
      opening: m.minutesOpening, closing: m.minutesClosing,
      items: items.map((i) => ({
        seq: i.seq, title: i.title, presenter: i.presenterName, discussion: i.discussion, status: i.status,
        recommendations: recs.filter((r) => r.itemId === i.id).map((r) => ({
          seq: r.seq, kind: r.kind === 'decision' ? 'قرار' : 'توصية', text: r.text, owner: r.ownerName, supporters: r.supporters.map((s) => s.name), dueDate: r.dueDate,
          votes: r.votesFor === null ? null : { for: r.votesFor, against: r.votesAgainst, abstain: r.votesAbstain },
        })),
      })),
    };
  }

  private async mutate(actor: OrgUser, id: string, fn: (em: EntityManager, ctx: { m: MtgMeeting; body: MtgBody; attendees: MtgAttendee[] }) => Promise<void>, manage = true) {
    await this.db.transaction(async (em) => {
      const ctx = await this.meetings.load(em, actor.organizationId, id, true);
      if (!this.core.canSee(actor, ctx.m, ctx.body, ctx.attendees)) this.core.forbid();
      if (manage && !this.core.canManage(actor, ctx.m, ctx.body)) throw new ForbiddenException('إدارة المحضر لأمين السر أو منظم الاجتماع');
      await fn(em, ctx);
      await em.getRepository(MtgMeeting).save(ctx.m);
    });
    return this.meetings.get(actor, id);
  }

  /** إصدار المحضر للتوقيع: يُجمد النص وبصمته، ويُطلب التوقيع من الحاضرين */
  issue(actor: OrgUser, id: string) {
    return this.mutate(actor, id, async (em, { m, body, attendees }) => {
      if (m.status !== 'held') throw new ConflictException('يصدر المحضر بعد إنهاء الاجتماع');
      const items = await em.getRepository(MtgAgendaItem).find({ where: { meetingId: m.id } });
      const pending = items.filter((i) => i.status === 'pending');
      if (pending.length) bad(`حدد حالة كل بند (نوقش أو أُجّل) قبل إصدار المحضر: ${pending.map((i) => i.seq).join('، ')}`);
      const missing = items.filter((i) => i.status === 'discussed' && !i.discussion?.trim());
      if (missing.length) bad(`اكتب ملخص المناقشات للبنود: ${missing.map((i) => i.seq).join('، ')}`);
      const present = attendees.filter((a) => a.attendance && PRESENT.includes(a.attendance));
      if (!present.length) bad('لا يوجد حاضرون للتوقيع');
      const s = await this.core.settings(m.organizationId, em);
      m.minutesVersion += 1;
      const snap = await this.snapshot(em, m, body);
      Object.assign(m, {
        status: 'signing', minutesStatus: 'signing', minutesSnapshot: snap, minutesHash: sha(stable(snap)), minutesIssuedAt: new Date(),
        signDeadline: addDays(today(), s.signDays), adoptedAt: null, adoptionMethod: null, adoptionNote: null, wetCopy: null,
      });
      for (const a of attendees) {
        const signer = a.attendance && PRESENT.includes(a.attendance);
        await em.getRepository(MtgAttendee).update({ id: a.id }, {
          signStatus: signer ? 'pending' : 'none', signedAt: null, signMethod: null, signHash: null, signReason: null, signIp: null,
          signTokenHash: null, signCodeHash: null, signLinkExpires: null, signFailures: 0, signLockedUntil: null,
        });
      }
      m.history.push(this.hist(actor.fullName, 'issue', `الإصدار ${m.minutesVersion}`));
    });
  }

  /** سحب المحضر للتعديل: تبطل كل التوقيعات، ويصدر بإصدار جديد بعد التعديل */
  recall(actor: OrgUser, id: string, dto: NoteDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (m.status !== 'signing') throw new ConflictException('المحضر ليس قيد التوقيع');
      await em.getRepository(MtgAttendee).update({ meetingId: m.id }, {
        signStatus: 'none', signedAt: null, signMethod: null, signHash: null, signReason: null, signTokenHash: null, signCodeHash: null, signLinkExpires: null,
      });
      Object.assign(m, { status: 'held', minutesStatus: 'none', minutesHash: null, signDeadline: null });
      m.history.push(this.hist(actor.fullName, 'recall', dto.note));
    });
  }

  private assertLocked(a: MtgAttendee) {
    if (a.signLockedUntil && a.signLockedUntil > new Date()) {
      throw new ForbiddenException(`أُوقف التوقيع مؤقتًا بعد ${MAX_FAILURES} محاولات خاطئة. حاول بعد ${Math.ceil((a.signLockedUntil.getTime() - Date.now()) / 60000)} دقيقة`);
    }
  }

  /** تسجيل محاولة خاطئة خارج معاملة التوقيع (حتى لا يلغيها رفض الطلب) */
  private async failure(a: MtgAttendee, what: string): Promise<never> {
    const failures = a.signFailures + 1;
    const locked = failures >= MAX_FAILURES;
    await this.db.getRepository(MtgAttendee).update({ id: a.id }, { signFailures: locked ? 0 : failures, signLockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60000) : null });
    throw new ForbiddenException(locked ? `${what} غير صحيح. أُوقف التوقيع ${LOCK_MINUTES} دقيقة` : `${what} غير صحيح (بقي ${MAX_FAILURES - failures} محاولات)`);
  }

  /** توقيع مستخدم النظام: بإعادة إدخال كلمة مرور حسابه، ويُربط التوقيع ببصمة المحضر */
  async sign(actor: OrgUser, id: string, dto: SignDto, ip: string) {
    const { m, attendees } = await this.meetings.load(this.db.manager, actor.organizationId, id);
    const me = attendees.find((a) => a.userId === actor.id) ?? this.core.forbid();
    this.assertLocked(me);
    const [u] = await this.db.query('SELECT password_hash FROM users WHERE id = $1 AND organization_id = $2 AND is_active', [actor.id, actor.organizationId]);
    if (!u || !(await bcrypt.compare(dto.password, u.password_hash))) await this.failure(me, 'كلمة المرور');
    if (m.status !== 'signing' || me.signStatus !== 'pending') throw new ConflictException('لا يوجد محضر بانتظار توقيعك');
    await this.record(actor.organizationId, id, me.id, dto.decision, dto.reason ?? null, 'password', ip, actor.fullName);
    return this.meetings.get(actor, id);
  }

  private async record(org: string, meetingId: string, attendeeId: string, decision: 'sign' | 'abstain', reason: string | null, method: 'password' | 'code', ip: string, byName: string) {
    if (decision === 'abstain' && (!reason || reason.length < 3)) bad('اكتب سبب الامتناع عن التوقيع');
    await this.db.transaction(async (em) => {
      const m = await em.getRepository(MtgMeeting).findOneOrFail({ where: { id: meetingId, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      const a = await em.getRepository(MtgAttendee).findOneOrFail({ where: { id: attendeeId, meetingId } });
      if (m.status !== 'signing' || a.signStatus !== 'pending') throw new ConflictException('لا يوجد محضر بانتظار توقيعك');
      // التحقق من سلامة النص: البصمة المخزنة تطابق النسخة المجمدة
      if (!m.minutesSnapshot || sha(stable(m.minutesSnapshot)) !== m.minutesHash) throw new ConflictException('نص المحضر لا يطابق بصمته؛ أبلغ أمين السر');
      await em.getRepository(MtgAttendee).update({ id: a.id }, {
        signStatus: decision === 'sign' ? 'signed' : 'abstained', signedAt: new Date(), signMethod: method, signHash: m.minutesHash, signReason: decision === 'abstain' ? reason : null,
        signIp: ip.slice(0, 64), signFailures: 0, signLockedUntil: null, signTokenHash: null, signCodeHash: null, signLinkExpires: null,
      });
      m.history.push(this.hist(byName, decision === 'sign' ? 'sign' : 'abstain', decision === 'abstain' ? reason : null));
      await this.maybeAdopt(em, m, byName);
      await em.getRepository(MtgMeeting).save(m);
    });
  }

  /** يعتمد المحضر تلقائيًا حين يوقع كل الحاضرين أو يمتنعوا */
  private async maybeAdopt(em: EntityManager, m: MtgMeeting, byName: string) {
    const rest = await em.getRepository(MtgAttendee).count({ where: { meetingId: m.id, signStatus: 'pending' } });
    if (rest) return;
    const methods = await em.getRepository(MtgAttendee).find({ where: { meetingId: m.id, signStatus: In(['signed', 'abstained']) }, select: ['signMethod'] });
    const wet = methods.some((x) => x.signMethod === 'wet');
    const el = methods.some((x) => x.signMethod && x.signMethod !== 'wet');
    await this.adopt(em, m, byName, wet && el ? 'mixed' : wet ? 'wet' : 'electronic', null);
  }

  /** اعتماد المحضر: تتحول التوصيات ذات المسؤول إلى مهام */
  private async adopt(em: EntityManager, m: MtgMeeting, byName: string, method: 'electronic' | 'wet' | 'mixed', note: string | null) {
    Object.assign(m, { status: 'adopted', minutesStatus: 'adopted', adoptedAt: new Date(), adoptionMethod: method, adoptionNote: note });
    m.history.push(this.hist(byName, 'adopt', note));
    const s = await this.core.settings(m.organizationId, em);
    const recs = await em.getRepository(MtgRecommendation).find({ where: { meetingId: m.id }, order: { seq: 'ASC' } });
    const items = new Map((await em.getRepository(MtgAgendaItem).find({ where: { meetingId: m.id } })).map((i) => [i.id, i]));
    // المهام تُسند باسم منشئ الاجتماع (أمين السر)
    const [creator] = await em.query('SELECT id, full_name, email FROM users WHERE id = $1', [m.createdById]);
    const actor: OrgUser = {
      id: m.createdById, organizationId: m.organizationId, organizationName: null, organizationSlug: null, email: creator?.email ?? '', username: null,
      fullName: creator?.full_name ?? m.createdByName, isSuperadmin: false, isPlatformAdmin: false, permissions: [],
    };
    for (const r of recs) {
      if (!r.ownerUserId || r.taskId) continue;
      const active = await em.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [r.ownerUserId]);
      if (!active.length) continue;
      const item = items.get(r.itemId);
      const t = await this.tasks.createFromSource(em, actor, {
        title: r.text.length > 280 ? `${r.text.slice(0, 277)}...` : r.text,
        description: `${r.kind === 'decision' ? 'قرار' : 'توصية'} رقم ${r.seq} في ${m.title} (${m.refNo}) بتاريخ ${m.meetingDate}${item ? `، البند ${item.seq}: ${item.title}` : ''}\n\n${r.text}`,
        ownerUserId: r.ownerUserId, supporterUserIds: r.supporters.map((x) => x.userId), dueDate: r.dueDate && r.dueDate >= today() ? r.dueDate : addDays(today(), s.taskDays),
        sourceType: 'meeting', sourceId: m.id, sourceRef: `اجتماع ${m.refNo}`, sourceLink: `/meetings/m/${m.id}`, isConfidential: m.isConfidential,
      });
      await em.getRepository(MtgRecommendation).update({ id: r.id }, { taskId: t.id, taskRef: t.refNo });
    }
  }

  /** رابط توقيع شخصي ورمز تحقق للحاضر من خارج النظام (عضو جمعية عمومية أو ضيف). يظهر الرمز مرة واحدة */
  async signLink(actor: OrgUser, id: string, attendeeId: string, origin: string) {
    let token = '';
    let code = '';
    let name = '';
    await this.mutate(actor, id, async (em, { m, attendees }) => {
      if (m.status !== 'signing') throw new ConflictException('المحضر ليس قيد التوقيع');
      const a = attendees.find((x) => x.id === attendeeId) ?? this.core.notFound('الحاضر');
      if (a.userId) bad('هذا الحاضر يوقع من حسابه في النظام بكلمة المرور');
      if (a.signStatus !== 'pending') bad('هذا الحاضر ليس بانتظار التوقيع');
      token = randomBytes(24).toString('base64url');
      code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      name = a.name;
      const exp = new Date(`${m.signDeadline ?? addDays(today(), 7)}T23:59:59+03:00`);
      await em.getRepository(MtgAttendee).update({ id: a.id }, { signTokenHash: sha(token), signCodeHash: sha(`${a.id}:${code}`), signLinkExpires: exp, signFailures: 0, signLockedUntil: null });
      m.history.push(this.hist(actor.fullName, 'link', a.name));
    });
    return { name, url: `${origin}/minutes/sign/${token}`, code, note: 'أرسل الرابط والرمز للحاضر كلًا في رسالة منفصلة. الرمز لا يظهر مرة أخرى، ويمكن إصدار رمز جديد يلغي السابق.' };
  }

  private async byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException('الرابط غير صحيح');
    const a = await this.db.getRepository(MtgAttendee).findOne({ where: { signTokenHash: sha(token) } });
    if (!a || !a.signLinkExpires || a.signLinkExpires < new Date()) throw new NotFoundException('الرابط غير صحيح أو انتهت صلاحيته. اطلب رابطًا جديدًا من أمين السر');
    const m = await this.db.getRepository(MtgMeeting).findOneOrFail({ where: { id: a.meetingId } });
    return { a, m };
  }

  async publicView(token: string) {
    const { a, m } = await this.byToken(token);
    return { name: a.name, role: ROLE_AR[a.role], status: m.status, signStatus: a.signStatus, hash: m.minutesHash, deadline: m.signDeadline, minutes: m.minutesSnapshot };
  }

  async publicSign(token: string, dto: PublicSignDto, ip: string) {
    const { a, m } = await this.byToken(token);
    this.assertLocked(a);
    if (a.signCodeHash !== sha(`${a.id}:${dto.code}`)) await this.failure(a, 'رمز التحقق');
    await this.record(m.organizationId, m.id, a.id, dto.decision, dto.reason ?? null, 'code', ip, a.name);
    return { ok: true, decision: dto.decision };
  }

  /** رفع النسخة الموقعة بالتوقيع الحي: يعتمد المحضر، ومن لم يوقع إلكترونيًا يُعد موقعًا على الورق */
  async wetCopy(actor: OrgUser, id: string, file: Express.Multer.File | undefined, note: string | null) {
    const saved = await this.files.save(`meetings/${actor.organizationId}`, file, 'النسخة الموقعة');
    return this.mutate(actor, id, async (em, { m }) => {
      if (m.status !== 'signing') throw new ConflictException('ارفع النسخة الموقعة بعد إصدار المحضر للتوقيع');
      m.wetCopy = { key: saved.key, name: saved.name, mime: saved.mime, size: file?.size ?? 0, byName: actor.fullName, at: new Date().toISOString() };
      await em.getRepository(MtgAttendee).update({ meetingId: m.id, signStatus: 'pending' }, { signStatus: 'signed', signMethod: 'wet', signedAt: new Date(), signHash: m.minutesHash });
      m.history.push(this.hist(actor.fullName, 'wet', note));
      await this.maybeAdopt(em, m, actor.fullName);
    });
  }

  /** اعتماد المحضر بالتوقيعات الحالية بعد انتهاء مهلة التوقيع: من لم يوقع يُسجل «لم يوقع» */
  finalize(actor: OrgUser, id: string, dto: NoteDto) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      if (m.status !== 'signing') throw new ConflictException('المحضر ليس قيد التوقيع');
      if (m.signDeadline && m.signDeadline >= today()) bad(`مهلة التوقيع تنتهي ${m.signDeadline}؛ يعتمد المحضر قبلها حين يوقع الجميع أو برفع النسخة الموقعة`);
      if (!attendees.some((a) => a.signStatus === 'signed')) bad('لا يعتمد المحضر بلا أي توقيع');
      await em.getRepository(MtgAttendee).update({ meetingId: m.id, signStatus: 'pending' }, { signStatus: 'not_signed', signTokenHash: null, signCodeHash: null });
      await this.adopt(em, m, actor.fullName, attendees.some((a) => a.signMethod === 'wet') ? 'mixed' : 'electronic', dto.note);
    });
  }

  /** نسخة الطباعة: المحضر المجمد بعد إصداره، أو المسودة الحالية قبله */
  async print(actor: OrgUser, id: string) {
    const { m, body, attendees } = await this.meetings.load(this.db.manager, actor.organizationId, id);
    if (!this.core.canSee(actor, m, body, attendees)) this.core.forbid();
    const s = await this.core.settings(actor.organizationId);
    const minutes = m.minutesSnapshot && m.minutesStatus !== 'none' ? m.minutesSnapshot : await this.snapshot(this.db.manager, m, body);
    return {
      draft: m.minutesStatus === 'none', minutes, hash: m.minutesStatus === 'none' ? null : m.minutesHash, verifyCode: m.minutesStatus === 'none' ? null : m.verifyCode,
      issuedAt: m.minutesIssuedAt, adoptedAt: m.adoptedAt, adoptionMethod: m.adoptionMethod, footer: s.minutesFooter,
      signatures: attendees.filter((a) => a.signStatus !== 'none' || (m.minutesStatus === 'none' && a.attendance && PRESENT.includes(a.attendance))).map((a) => ({
        name: a.name, role: ROLE_AR[a.role], status: a.signStatus, statusLabel: SIGN_AR[a.signStatus], method: a.signMethod, at: a.signedAt, reason: a.signReason,
      })),
    };
  }

  /** التحقق العام من المحضر برمز التحقق (بلا محتوى المحضر) */
  async verify(code: string) {
    if (!/^[A-Z0-9]{8,16}$/.test(code)) throw new NotFoundException('رمز التحقق غير صحيح');
    const m = await this.db.getRepository(MtgMeeting).findOne({ where: { verifyCode: code } });
    if (!m || m.minutesStatus === 'none') throw new NotFoundException('لا يوجد محضر بهذا الرمز');
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [m.organizationId]);
    const body = await this.db.getRepository(MtgBody).findOneOrFail({ where: { id: m.bodyId } });
    const attendees = await this.db.getRepository(MtgAttendee).find({ where: { meetingId: m.id }, order: { sortOrder: 'ASC' } });
    return {
      organization: org?.name, body: body.name, refNo: m.refNo, title: m.isConfidential ? 'اجتماع سري' : m.title, date: m.meetingDate, version: m.minutesVersion,
      hash: m.minutesHash, status: m.minutesStatus, adoptedAt: m.adoptedAt, adoptionMethod: m.adoptionMethod, wetCopy: !!m.wetCopy,
      signatures: attendees.filter((a) => a.signStatus !== 'none').map((a) => ({
        name: a.name, role: ROLE_AR[a.role], status: SIGN_AR[a.signStatus], method: a.signMethod, at: a.signedAt, matches: a.signHash === m.minutesHash,
      })),
    };
  }
}
