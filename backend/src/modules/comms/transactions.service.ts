import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { PendingTask } from '../../core/tasks/tasks.registry';
import { VouchersService } from '../accounting/vouchers.service';
import {
  CONF_AR, CommsCore, DIRECTION_AR, DOC_AR, KIND_AR, PRIORITY_AR, PURPOSE_AR, TXN_STATUS_AR, addDays, today,
} from './comms-core.service';
import { CloseDto, NoteDto, ReferDto, TaskFromTxnDto, TransactionDto } from './comms.dto';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { CommsTransaction, Movement, PersonRef, Recipient } from './entities/comms.entity';
import { TasksService } from './tasks.service';

const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const PREFIX: Record<string, string> = { transaction: 'TR', decision: 'DC', circular: 'CR' };

/**
 * المعاملات الإدارية والمالية: تُنشأ وتُحال بين الإدارات والموظفين (الإحالة لإدارة تصل لمديرها في الهيكل)،
 * ولكل معاملة حائز واحد في كل وقت. المتابعون يطلعون دون أن يتدخلوا. المعاملة الإدارية تنتهي بالإنجاز أو الحفظ،
 * والمالية تنتهي بسند قبض أو صرف في النظام المالي أو بالحفظ.
 * القرارات والتعاميم تُصدر دفعة واحدة لمجموعة موجه إليها، ويسجل اطلاع كل شخص.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: CommsCore,
    private readonly files: FileStore,
    private readonly vouchers: VouchersService,
    private readonly tasks: TasksService,
  ) {}

  private row(t: CommsTransaction, me: string) {
    const overdue = t.status === 'open' && !!t.dueDate && t.dueDate < today();
    const myRecipient = t.recipients.find((r) => r.userId === me);
    return {
      id: t.id, refNo: t.refNo, docType: t.docType, docLabel: DOC_AR[t.docType], kind: t.kind, kindLabel: KIND_AR[t.kind], direction: t.direction,
      directionLabel: DIRECTION_AR[t.direction], externalParty: t.externalParty, categoryName: t.categoryName, subject: t.subject,
      confidentiality: t.confidentiality, confidentialityLabel: CONF_AR[t.confidentiality], priority: t.priority, priorityLabel: PRIORITY_AR[t.priority],
      financialType: t.financialType, amount: t.amount === null ? null : Number(t.amount), status: t.status, statusLabel: TXN_STATUS_AR[t.status],
      createdByName: t.createdByName, originUnitName: t.originUnitName, holderUserId: t.holderUserId, holderName: t.holderName, holderUnitName: t.holderUnitName,
      holderPurpose: t.holderPurpose, holderPurposeLabel: t.holderPurpose ? PURPOSE_AR[t.holderPurpose] : null, holderSince: t.holderSince,
      dueDate: t.dueDate, overdue, isHolder: t.holderUserId === me && t.status === 'open', isFollower: t.followerUserIds.includes(me),
      unread: !!myRecipient && !myRecipient.readAt, recipientsCount: t.recipients.length, readCount: t.recipients.filter((r) => r.readAt).length,
      voucherSerial: t.voucherSerial, closeKind: t.closeKind, createdAt: t.createdAt, updatedAt: t.updatedAt, issuedAt: t.issuedAt,
    };
  }

  // ---------------- القراءة ----------------

  async list(actor: OrgUser, q: { box?: string; status?: string; docType?: string; kind?: string; confidentiality?: string; q?: string }) {
    const org = actor.organizationId;
    const params: unknown[] = [org, actor.id];
    const where = [`t.organization_id = $1`, this.core.visibleSql(actor, 2)];
    const box = q.box ?? 'inbox';
    if (box === 'inbox') where.push(`t.holder_user_id = $2 AND t.status = 'open'`);
    else if (box === 'sent') where.push(`t.created_by_id = $2`);
    else if (box === 'following') where.push(`$2 = ANY(t.follower_user_ids)`);
    else if (box === 'involved') where.push(`$2 = ANY(t.party_user_ids) AND t.doc_type = 'transaction'`);
    else if (box === 'decisions') where.push(`t.doc_type <> 'transaction' AND t.status = 'issued'`);
    else if (box === 'registry') {
      if (!this.core.can(actor, P.registry) && !this.core.can(actor, P.registryMedium)) throw new ForbiddenException('سجل المعاملات يحتاج صلاحية');
      where.push(`t.status <> 'draft'`);
    } else bad('العرض غير معروف');
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status === 'overdue') add(`t.status = 'open' AND t.due_date < ?`, today());
    else if (q.status) add('t.status = ?', q.status);
    if (q.docType) add('t.doc_type = ?', q.docType);
    if (q.kind) add('t.kind = ?', q.kind);
    if (q.confidentiality) add('t.confidentiality = ?', q.confidentiality);
    if (q.q) add(`(t.subject ILIKE ? OR t.ref_no ILIKE $${params.length} OR COALESCE(t.external_party, '') ILIKE $${params.length})`, `%${q.q}%`);
    const ids: { id: string }[] = await this.db.query(`SELECT t.id FROM comms_transactions t WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT 1000`, params);
    const rows = ids.length ? await this.db.getRepository(CommsTransaction).createQueryBuilder('t').whereInIds(ids.map((i) => i.id)).orderBy('t.updated_at', 'DESC').getMany() : [];
    return { items: rows.map((t) => this.row(t, actor.id)), counts: await this.counts(actor) };
  }

  async counts(actor: OrgUser) {
    const [c] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE t.holder_user_id = $2 AND t.status = 'open')::int AS inbox,
              COUNT(*) FILTER (WHERE t.holder_user_id = $2 AND t.status = 'open' AND t.due_date < $3)::int AS overdue,
              COUNT(*) FILTER (WHERE $2 = ANY(t.follower_user_ids) AND t.status = 'open')::int AS following,
              COUNT(*) FILTER (WHERE t.created_by_id = $2 AND t.status = 'draft')::int AS drafts,
              COUNT(*) FILTER (WHERE t.doc_type <> 'transaction' AND t.status = 'issued' AND t.recipients @> jsonb_build_array(jsonb_build_object('userId', $2::text, 'readAt', null)))::int AS unread
         FROM comms_transactions t WHERE t.organization_id = $1 AND ${this.core.visibleSql(actor, 2)}`, [actor.organizationId, actor.id, today()],
    );
    return c;
  }

  private async load(em: EntityManager, org: string, id: string, lock = false) {
    const t = await em.getRepository(CommsTransaction).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    return t ?? this.core.notFound('المعاملة');
  }

  private assertSee(actor: OrgUser, t: CommsTransaction) {
    if (!this.core.canSee(actor, t)) throw new ForbiddenException(`لا يمكنك الاطلاع على هذه ${DOC_AR[t.docType]} (${CONF_AR[t.confidentiality]})`);
  }

  async get(actor: OrgUser, id: string) {
    const t = await this.load(this.db.manager, actor.organizationId, id);
    this.assertSee(actor, t);
    const isParty = t.partyUserIds.includes(actor.id);
    const isCreator = t.createdById === actor.id;
    const tasks: { id: string; ref_no: string; title: string; owner_name: string; status: string; due_date: string }[] = await this.db.query(
      `SELECT id, ref_no, title, owner_name, status, due_date::text FROM comms_tasks WHERE organization_id = $1 AND source_type = 'transaction' AND source_id = $2 ORDER BY created_at`,
      [actor.organizationId, t.id],
    );
    return {
      ...this.row(t, actor.id), body: t.body, externalRef: t.externalRef, partyName: t.partyName, categoryCode: t.categoryCode,
      followers: t.followers, recipients: isParty || this.core.can(actor, P.decisions) ? t.recipients : t.recipients.filter((r) => r.userId === actor.id),
      movements: t.movements, attachments: t.attachments.map(({ key: _k, ...a }) => a), closeNote: t.closeNote, closedAt: t.closedAt, closedByName: t.closedByName,
      voucherId: t.voucherId, tasks: tasks.map((x) => ({ id: x.id, refNo: x.ref_no, title: x.title, ownerName: x.owner_name, status: x.status, dueDate: x.due_date })),
      can: {
        act: t.status === 'open' && t.holderUserId === actor.id,
        edit: t.status === 'draft' && isCreator,
        follow: t.confidentiality !== 'top_secret' && (isCreator || (t.status === 'open' && t.holderUserId === actor.id)),
        attach: isParty && ['draft', 'open'].includes(t.status),
        voucher: t.kind === 'financial' && this.core.can(actor, P.financial),
        reopen: ['closed', 'archived'].includes(t.status) && (isCreator || t.closedByName === actor.fullName) && !t.voucherId,
        cancel: (t.status === 'draft' || (t.status === 'open' && t.docType === 'transaction')) && isCreator,
        task: t.status === 'open' && t.holderUserId === actor.id,
      },
    };
  }

  // ---------------- الإنشاء ----------------

  private mv(actor: OrgUser, kind: string, extra: Partial<Movement> = {}): Movement {
    return { at: new Date().toISOString(), kind, byId: actor.id, byName: actor.fullName, ...extra };
  }

  private async target(em: EntityManager, org: string, d: { toUserId?: string | null; toUnitId?: string | null }) {
    if (d.toUserId) {
      const p = await this.core.person(org, d.toUserId, em);
      return { userId: p.id, name: p.fullName, unitName: p.unitName };
    }
    if (d.toUnitId) return this.core.unitHolder(org, d.toUnitId, em);
    return bad('اختر الموظف أو الإدارة المحال إليها');
  }

  private async followersOf(em: EntityManager, org: string, ids: string[]): Promise<PersonRef[]> {
    const out: PersonRef[] = [];
    for (const id of [...new Set(ids)]) {
      const p = await this.core.person(org, id, em);
      out.push({ userId: p.id, name: p.fullName, unitName: p.unitName });
    }
    return out;
  }

  /** يبني الحقول من النموذج (يُستخدم في الإنشاء وتعديل المسودة) */
  private async fields(em: EntityManager, actor: OrgUser, dto: TransactionDto) {
    const org = actor.organizationId;
    const s = await this.core.settings(org, em);
    const cat = dto.categoryCode ? s.categories.find((c) => c.code === dto.categoryCode) : null;
    if (dto.categoryCode && !cat) bad('التصنيف غير موجود');
    if (dto.docType !== 'transaction' && !this.core.can(actor, P.decisions)) throw new ForbiddenException('إصدار القرارات والتعاميم يحتاج صلاحية');
    const kind = dto.docType === 'transaction' ? dto.kind : 'admin';
    if (kind === 'financial') {
      if (!dto.financialType) bad('حدد هل المعاملة المالية قبض أم صرف');
      if (!dto.amount) bad('اكتب مبلغ المعاملة المالية');
    }
    if (dto.confidentiality === 'top_secret' && dto.followerUserIds?.length) bad('المعاملات عالية السرية لا يضاف لها متابعون: لا يراها إلا الموجهة لهم');
    const me = await this.core.person(org, actor.id, em).catch(() => null);
    const followers = await this.followersOf(em, org, dto.followerUserIds ?? []);
    return {
      docType: dto.docType, kind, direction: dto.docType === 'transaction' ? dto.direction ?? 'internal' : 'internal',
      externalParty: dto.externalParty ?? null, externalRef: dto.externalRef ?? null, categoryCode: cat?.code ?? null, categoryName: cat?.name ?? null,
      subject: dto.subject, body: dto.body ?? '', confidentiality: dto.confidentiality, priority: dto.priority,
      financialType: kind === 'financial' ? dto.financialType ?? null : null, amount: kind === 'financial' && dto.amount ? String(dto.amount) : null,
      partyName: kind === 'financial' ? dto.partyName ?? dto.externalParty ?? null : null,
      originUnitId: me?.unitId ?? null, originUnitName: me?.unitName ?? null,
      followers, followerUserIds: followers.map((f) => f.userId), dueDays: cat?.dueDays ?? null,
    };
  }

  async create(actor: OrgUser, dto: TransactionDto) {
    if (!this.core.can(actor, P.create) && dto.docType === 'transaction') throw new ForbiddenException('إنشاء المعاملات يحتاج صلاحية');
    const id = await this.db.transaction(async (em) => {
      const { dueDays, ...f } = await this.fields(em, actor, dto);
      const t = em.create(CommsTransaction, {
        ...f, organizationId: actor.organizationId, refNo: `DRAFT-${randomUUID().slice(0, 8)}`, createdById: actor.id, createdByName: actor.fullName,
        status: 'draft', partyUserIds: [actor.id], movements: [this.mv(actor, 'create')], attachments: [], recipients: [],
      });
      if (!dto.draft) await this.dispatch(em, actor, t, dto, dueDays);
      return (await em.getRepository(CommsTransaction).save(t)).id;
    });
    return this.get(actor, id);
  }

  async update(actor: OrgUser, id: string, dto: TransactionDto) {
    await this.db.transaction(async (em) => {
      const t = await this.load(em, actor.organizationId, id, true);
      if (t.status !== 'draft' || t.createdById !== actor.id) throw new ConflictException('تُعدل المسودة فقط ومن منشئها');
      const { dueDays, ...f } = await this.fields(em, actor, dto);
      Object.assign(t, f);
      if (!dto.draft) await this.dispatch(em, actor, t, dto, dueDays);
      await em.getRepository(CommsTransaction).save(t);
    });
    return this.get(actor, id);
  }

  /** إرسال المسودة: المعاملة تُحال لأول جهة، والقرار أو التعميم يصدر للموجه إليهم */
  private async dispatch(em: EntityManager, actor: OrgUser, t: CommsTransaction, dto: TransactionDto, dueDays: number | null) {
    const org = actor.organizationId;
    t.refNo = await this.core.nextRef(em, org, PREFIX[t.docType]);
    if (t.docType === 'transaction') {
      const to = await this.target(em, org, dto);
      if (to.userId === actor.id) bad('لا يمكن إحالة المعاملة إلى نفسك');
      const due = dto.dueDate ?? (dueDays ? addDays(today(), dueDays) : null);
      Object.assign(t, {
        status: 'open', holderUserId: to.userId, holderName: to.name, holderUnitName: to.unitName, holderPurpose: dto.purpose ?? 'action', holderSince: new Date(), dueDate: due,
      });
      t.partyUserIds = [...new Set([...t.partyUserIds, to.userId])];
      t.movements.push(this.mv(actor, 'refer', { toUserId: to.userId, toName: to.name, toUnitName: to.unitName, purpose: dto.purpose ?? 'action', note: dto.note ?? null, dueDate: due }));
      return;
    }
    // قرار أو تعميم
    const people = new Map<string, Recipient>();
    for (const u of await this.core.unitUsers(org, dto.recipientUnitIds ?? [])) people.set(u.id, { userId: u.id, name: u.fullName, unitName: u.unitName, readAt: null });
    for (const id of dto.recipientUserIds ?? []) {
      if (people.has(id)) continue;
      const p = await this.core.person(org, id, em);
      people.set(p.id, { userId: p.id, name: p.fullName, unitName: p.unitName, readAt: null });
    }
    people.delete(actor.id);
    if (!people.size) bad(`اختر الموجه إليهم ${DOC_AR[t.docType]} (أشخاص أو إدارات فيها موظفون بحسابات دخول)`);
    t.recipients = [...people.values()];
    t.partyUserIds = [...new Set([...t.partyUserIds, ...people.keys()])];
    Object.assign(t, { status: 'issued', issuedAt: new Date(), holderUserId: null, holderName: null, holderUnitName: null, holderPurpose: null, dueDate: null });
    t.movements.push(this.mv(actor, 'issue', { note: `${DOC_AR[t.docType]} موجه إلى ${people.size} شخصًا` }));
  }

  // ---------------- الإجراءات ----------------

  private async act(actor: OrgUser, id: string, fn: (em: EntityManager, t: CommsTransaction) => Promise<void> | void) {
    await this.db.transaction(async (em) => {
      const t = await this.load(em, actor.organizationId, id, true);
      this.assertSee(actor, t);
      await fn(em, t);
      await em.getRepository(CommsTransaction).save(t);
    });
    return this.get(actor, id);
  }

  private assertHolder(actor: OrgUser, t: CommsTransaction) {
    if (t.status !== 'open' || t.holderUserId !== actor.id) throw new ForbiddenException('الإجراء لمن المعاملة عنده الآن فقط؛ المتابعون يطلعون دون تدخل');
  }

  refer(actor: OrgUser, id: string, dto: ReferDto) {
    return this.act(actor, id, async (em, t) => {
      this.assertHolder(actor, t);
      const to = await this.target(em, actor.organizationId, dto);
      if (to.userId === actor.id) bad('المعاملة عندك بالفعل');
      Object.assign(t, { holderUserId: to.userId, holderName: to.name, holderUnitName: to.unitName, holderPurpose: dto.purpose, holderSince: new Date(), dueDate: dto.dueDate ?? t.dueDate });
      t.partyUserIds = [...new Set([...t.partyUserIds, to.userId])];
      t.movements.push(this.mv(actor, 'refer', { toUserId: to.userId, toName: to.name, toUnitName: to.unitName, purpose: dto.purpose, note: dto.note ?? null, dueDate: dto.dueDate ?? t.dueDate }));
    });
  }

  /** إعادة المعاملة لمن أحالها (آخر إحالة) مع الإفادة */
  returnBack(actor: OrgUser, id: string, dto: NoteDto) {
    return this.act(actor, id, async (em, t) => {
      this.assertHolder(actor, t);
      const last = [...t.movements].reverse().find((m) => m.kind === 'refer' && m.toUserId === actor.id && m.byId !== actor.id);
      if (!last) bad('لا توجد جهة سابقة لإعادة المعاملة إليها');
      const p = await this.core.person(actor.organizationId, last!.byId, em);
      Object.assign(t, { holderUserId: p.id, holderName: p.fullName, holderUnitName: p.unitName, holderPurpose: 'info', holderSince: new Date() });
      t.movements.push(this.mv(actor, 'return', { toUserId: p.id, toName: p.fullName, toUnitName: p.unitName, note: dto.note }));
    });
  }

  /** إفادة أو ملاحظة على المعاملة دون نقلها (لحائزها) */
  note(actor: OrgUser, id: string, dto: NoteDto) {
    return this.act(actor, id, (_em, t) => {
      this.assertHolder(actor, t);
      t.movements.push(this.mv(actor, 'note', { note: dto.note }));
    });
  }

  setFollowers(actor: OrgUser, id: string, userIds: string[]) {
    return this.act(actor, id, async (em, t) => {
      const allowed = t.createdById === actor.id || (t.status === 'open' && t.holderUserId === actor.id);
      if (!allowed) throw new ForbiddenException('يضيف المتابعين منشئ المعاملة أو من هي عنده');
      if (t.confidentiality === 'top_secret' && userIds.length) bad('المعاملات عالية السرية لا يضاف لها متابعون');
      t.followers = await this.followersOf(em, actor.organizationId, userIds.filter((u) => !t.partyUserIds.includes(u) || t.followerUserIds.includes(u)));
      t.followerUserIds = t.followers.map((f) => f.userId);
      t.movements.push(this.mv(actor, 'followers', { note: t.followers.length ? t.followers.map((f) => f.name).join('، ') : 'بلا متابعين' }));
    });
  }

  /** الاطلاع على قرار أو تعميم */
  acknowledge(actor: OrgUser, id: string) {
    return this.act(actor, id, (_em, t) => {
      const r = t.recipients.find((x) => x.userId === actor.id);
      if (!r) throw new ForbiddenException('القرار غير موجه إليك');
      if (r.readAt) return;
      r.readAt = new Date().toISOString();
      t.recipients = [...t.recipients];
      t.movements.push(this.mv(actor, 'ack'));
    });
  }

  close(actor: OrgUser, id: string, dto: CloseDto) {
    return this.act(actor, id, async (em, t) => {
      this.assertHolder(actor, t);
      if (t.docType !== 'transaction') bad('القرارات لا تغلق');
      if (dto.closeKind === 'voucher') {
        if (t.kind !== 'financial') bad('السند للمعاملات المالية فقط');
        if (!this.core.can(actor, P.financial)) throw new ForbiddenException('إنشاء سند من المعاملة يحتاج صلاحية «إغلاق المعاملات المالية»');
        const cashAccountId = dto.cashAccountId ?? bad('اختر البنك أو الصندوق');
        const counterAccountId = dto.counterAccountId ?? bad('اختر الحساب المقابل');
        const amount = dto.amount ?? (t.amount ? Number(t.amount) : null) ?? bad('اكتب مبلغ السند');
        const party = dto.partyName ?? t.partyName ?? t.externalParty ?? bad('اكتب اسم الجهة في السند');
        const kind = t.financialType === 'receipt' ? 'receipt' : 'payment';
        const v = await this.vouchers.insertDraft(em, actor, kind, {
          voucherDate: dto.voucherDate ?? today(), partyName: party, partnerId: null, amount, purpose: `${t.subject} - حسب المعاملة رقم ${t.refNo}`,
          sourceType: 'comms', sourceRef: t.refNo, projectName: null, method: dto.method ?? 'transfer', methodRef: dto.methodRef ?? null,
          cashAccountId, counterAccountId, analytic: dto.analytic ?? [],
        });
        Object.assign(t, { status: 'closed', closeKind: 'voucher', voucherId: v.id, voucherSerial: v.serial, amount: String(amount), partyName: party });
        t.movements.push(this.mv(actor, 'voucher', { note: `${kind === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${v.serial} (مسودة في النظام المالي)${dto.note ? ` - ${dto.note}` : ''}` }));
      } else {
        if (!dto.note || dto.note.length < 3) bad(dto.closeKind === 'archive' ? 'اكتب سبب الحفظ' : 'اكتب ما تم في المعاملة');
        Object.assign(t, { status: dto.closeKind === 'archive' ? 'archived' : 'closed', closeKind: dto.closeKind });
        t.movements.push(this.mv(actor, dto.closeKind, { note: dto.note }));
      }
      Object.assign(t, { closeNote: dto.note ?? null, closedAt: new Date(), closedByName: actor.fullName, holderPurpose: null });
    });
  }

  reopen(actor: OrgUser, id: string, dto: NoteDto) {
    return this.act(actor, id, (_em, t) => {
      if (!['closed', 'archived'].includes(t.status)) throw new ConflictException('المعاملة مفتوحة');
      if (t.voucherId) throw new ConflictException('المعاملة انتهت بسند مالي؛ عالج السند من النظام المالي');
      if (t.createdById !== actor.id && t.closedByName !== actor.fullName) throw new ForbiddenException('يعيد فتح المعاملة منشئها أو من أغلقها');
      Object.assign(t, { status: 'open', closeKind: null, closedAt: null, closedByName: null, holderUserId: actor.id, holderName: actor.fullName, holderPurpose: 'action', holderSince: new Date() });
      t.partyUserIds = [...new Set([...t.partyUserIds, actor.id])];
      t.movements.push(this.mv(actor, 'reopen', { note: dto.note }));
    });
  }

  cancel(actor: OrgUser, id: string, dto: NoteDto) {
    return this.act(actor, id, (_em, t) => {
      if (t.createdById !== actor.id) throw new ForbiddenException('يلغي المعاملة منشئها');
      if (!(t.status === 'draft' || (t.status === 'open' && t.docType === 'transaction'))) throw new ConflictException('لا يمكن إلغاء المعاملة في حالتها الحالية');
      Object.assign(t, { status: 'cancelled', holderUserId: null, holderPurpose: null });
      t.movements.push(this.mv(actor, 'cancel', { note: dto.note }));
    });
  }

  /** مهمة من المعاملة: يسندها حائز المعاملة لموظف بموعد إغلاق، وتُربط بالمعاملة */
  task(actor: OrgUser, id: string, dto: TaskFromTxnDto) {
    return this.act(actor, id, async (em, t) => {
      this.assertHolder(actor, t);
      const task = await this.tasks.createFromSource(em, actor, {
        title: dto.title, description: `من المعاملة ${t.refNo}: ${t.subject}`, ownerUserId: dto.ownerUserId, dueDate: dto.dueDate, priority: t.priority,
        sourceType: 'transaction', sourceId: t.id, sourceRef: `المعاملة ${t.refNo}`, sourceLink: `/comms/t/${t.id}`, isConfidential: this.core.confLevel(t.confidentiality) >= 2,
      });
      t.movements.push(this.mv(actor, 'task', { toName: task.ownerName, note: `${task.refNo}: ${task.title}`, dueDate: task.dueDate }));
    });
  }

  // ---------------- المرفقات ----------------

  async attach(actor: OrgUser, id: string, file: Express.Multer.File | undefined) {
    const t0 = await this.load(this.db.manager, actor.organizationId, id);
    if (!t0.partyUserIds.includes(actor.id) || !['draft', 'open'].includes(t0.status)) throw new ForbiddenException('يرفق المستندات أطراف المعاملة الجارية');
    const saved = await this.files.save(`comms/${actor.organizationId}`, file, 'المرفق');
    return this.act(actor, id, (_em, t) => {
      t.attachments = [...t.attachments, { id: randomUUID(), key: saved.key, name: saved.name, mime: saved.mime, size: file?.size ?? 0, byName: actor.fullName, at: new Date().toISOString() }];
      t.movements.push(this.mv(actor, 'attach', { note: saved.name }));
    });
  }

  async attachment(actor: OrgUser, id: string, fileId: string) {
    const t = await this.load(this.db.manager, actor.organizationId, id);
    this.assertSee(actor, t);
    const a = t.attachments.find((x) => x.id === fileId) ?? this.core.notFound('المرفق');
    return { doc: { mimeType: a.mime, fileName: a.name }, stream: this.files.open(a.key) };
  }

  // ---------------- جرس المهام ----------------

  async pendingFor(u: OrgUser): Promise<PendingTask[]> {
    const org = u.organizationId;
    const held = await this.db.getRepository(CommsTransaction).find({ where: { organizationId: org, holderUserId: u.id, status: 'open' }, order: { holderSince: 'ASC' }, take: 50 });
    const out: PendingTask[] = held.map((t) => ({
      id: `txn:${t.id}`, group: 'معاملات بانتظاري', link: `/comms/t/${t.id}`, at: t.holderSince,
      urgent: t.priority !== 'normal' || (!!t.dueDate && t.dueDate < today()),
      title: `${t.refNo}: ${t.subject}`, subtitle: `${t.holderPurpose ? PURPOSE_AR[t.holderPurpose] : ''}${t.dueDate ? ` · الموعد ${t.dueDate}` : ''} · ${CONF_AR[t.confidentiality]}`,
    }));
    const unread: { id: string; ref_no: string; subject: string; doc_type: string; issued_at: Date }[] = await this.db.query(
      `SELECT id, ref_no, subject, doc_type, issued_at FROM comms_transactions WHERE organization_id = $1 AND status = 'issued'
         AND recipients @> jsonb_build_array(jsonb_build_object('userId', $2::text, 'readAt', null)) ORDER BY issued_at DESC LIMIT 30`, [org, u.id],
    );
    for (const d of unread) out.push({ id: `dec:${d.id}`, group: 'قرارات وتعاميم للاطلاع', link: `/comms/t/${d.id}`, at: d.issued_at, title: `${DOC_AR[d.doc_type]} ${d.ref_no}: ${d.subject}` });
    return out;
  }
}
