import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { ApplicationStatus, ApprovalLog, MemApplication, MemInvoice, MemSettings, StoredDoc } from './entities/members.entity';
import { BillingService } from './billing.service';
import { MEMBER_PERMISSIONS as P } from './members.manifest';
import { ApplicationDto, DecisionDto } from './members.dto';
import { INVOICE_STATUS_AR, MembersService, personFields } from './members.service';
import { MemCore, shortCode, today } from './mem-core.service';
import { ageOn } from './mem-forms';

export const APP_STATUS_AR: Record<ApplicationStatus, string> = {
  in_review: 'قيد الاعتماد', returned: 'معاد لاستكمال البيانات', rejected: 'مرفوض', awaiting_payment: 'معتمد بانتظار السداد', completed: 'مكتمل (عضو)', cancelled: 'ملغى',
};
const log = (stage: string, decision: ApprovalLog['decision'], byName: string, note: string | null = null): ApprovalLog => ({ stage, decision, byName, at: new Date().toISOString(), note });

/**
 * طلبات العضوية: التقديم من الصفحة العامة أو إدخال الموظف، مراحل الاعتماد (اعتماد/إرجاع/رفض)،
 * وعند الاعتماد النهائي: مطالبة الاشتراك، أو تفعيل العضوية مباشرة إن كان النوع بدون اشتراك.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: MemCore,
    private readonly members: MembersService,
    private readonly billing: BillingService,
    private readonly files: FileStore,
  ) {}

  private assertConditions(s: MemSettings, accepted: string[] | undefined) {
    const missing = s.conditions.filter((c) => c.isActive && !(accepted ?? []).includes(c.key));
    if (missing.length) throw new BadRequestException(`يجب الإقرار بشروط العضوية: ${missing[0].text}`);
    return s.conditions.filter((c) => c.isActive).map((c) => c.key);
  }

  /** تقديم طلب جديد: من الصفحة العامة (public) أو يدخله موظف (staff) */
  async create(org: string, dto: ApplicationDto, files: Express.Multer.File[], source: 'public' | 'staff', byName: string | null) {
    const s = await this.core.settings(org);
    if (source === 'public' && !s.publicEnabled) throw new ForbiddenException('التقديم على العضوية من الموقع متوقف حاليًا');
    const { answers } = this.members.checkEligibility(s, dto, { publicOnly: source === 'public' });
    const accepted = this.assertConditions(s, dto.acceptedConditions);
    await this.db.transaction((em) => this.members.assertNoDuplicate(em, org, s, dto.nationalId));
    const { docs } = await this.members.saveDocuments(org, s, files);
    try {
      return await this.db.transaction(async (em) => {
        await this.members.assertNoDuplicate(em, org, s, dto.nationalId);
        const n = await this.core.nextNo(em, org, 'nextApplicationNo');
        const stages = s.stages.length ? s.stages : [{ name: 'اعتماد الطلب', roleId: null }];
        const a = await em.getRepository(MemApplication).save(em.create(MemApplication, {
          organizationId: org, applicationNo: `MA-${today().slice(0, 4)}-${String(n).padStart(4, '0')}`, typeCode: dto.typeCode, ...personFields(dto),
          answers, documents: docs, acceptedConditions: accepted, status: 'in_review', stageIndex: 0, stages, source, trackCode: shortCode(),
          approvalLog: [log(stages[0].name, 'submit', byName ?? dto.fullName, source === 'public' ? 'قُدم من صفحة العضوية العامة' : null)], createdByName: byName,
        }));
        return { id: a.id, applicationNo: a.applicationNo, trackCode: a.trackCode, fullName: a.fullName };
      });
    } catch (e) {
      await this.members.removeFiles(docs);
      throw e;
    }
  }

  /** إعادة تقديم طلب معاد: يحدّث البيانات والمستندات ويبدأ الاعتماد من المرحلة الأولى */
  async resubmit(org: string, id: string, dto: ApplicationDto, files: Express.Multer.File[], byName: string, publicOnly: boolean) {
    const s = await this.core.settings(org);
    const a = await this.load(org, id);
    if (a.status !== 'returned') throw new ConflictException('الطلب ليس معادًا للتعديل');
    const { answers } = this.members.checkEligibility(s, dto, { publicOnly, allowInactive: a.typeCode });
    const accepted = this.assertConditions(s, dto.acceptedConditions);
    const { docs, saved, replaced } = await this.members.saveDocuments(org, s, files, a.documents);
    try {
      await this.db.transaction(async (em) => {
        await this.members.assertNoDuplicate(em, org, s, dto.nationalId, id);
        const stages = s.stages.length ? s.stages : [{ name: 'اعتماد الطلب', roleId: null }];
        await em.getRepository(MemApplication).update({ id }, {
          ...personFields(dto), typeCode: dto.typeCode, answers, documents: docs, acceptedConditions: accepted, status: 'in_review', stageIndex: 0, stages,
          approvalLog: [...a.approvalLog, log(stages[0].name, 'resubmit', byName)],
        });
      });
    } catch (e) {
      await this.members.removeFiles(saved);
      throw e;
    }
    await this.members.removeFiles(replaced);
  }

  async decide(actor: OrgUser, id: string, dto: DecisionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const a = await em.getRepository(MemApplication).createQueryBuilder('a').setLock('pessimistic_write').where('a.id = :id AND a.organization_id = :org', { id, org }).getOne();
      if (!a) throw new NotFoundException('الطلب غير موجود');
      if (a.status !== 'in_review') throw new ConflictException('الطلب لا ينتظر قرارًا');
      const stage = a.stages[a.stageIndex];
      if (!(await this.core.canDecide(actor, stage))) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
      const name = stage?.name ?? 'الاعتماد';
      const repo = em.getRepository(MemApplication);
      if (dto.decision === 'reject' || dto.decision === 'return') {
        if (!dto.note) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب المطلوب استكماله ليظهر للمتقدم');
        await repo.update({ id }, { status: dto.decision === 'reject' ? 'rejected' : 'returned', approvalLog: [...a.approvalLog, log(name, dto.decision, actor.fullName, dto.note)] });
        return;
      }
      const approvalLog = [...a.approvalLog, log(name, 'approve', actor.fullName, dto.note ?? null)];
      if (a.stageIndex < a.stages.length - 1) {
        await repo.update({ id }, { stageIndex: a.stageIndex + 1, approvalLog });
        return;
      }
      await repo.update({ id }, { approvalLog });
      await this.finalApprove(em, { ...a, approvalLog }, actor.fullName);
    });
    return this.detail(actor, id);
  }

  /** الاعتماد النهائي: مطالبة الاشتراك، أو تفعيل مباشر إن لم يكن على النوع اشتراك */
  private async finalApprove(em: EntityManager, a: MemApplication, byName: string) {
    const s = await this.core.settings(a.organizationId, em);
    const t = this.core.type(s, a.typeCode);
    if (!t) throw new BadRequestException('نوع العضوية في الطلب لم يعد موجودًا');
    await this.members.assertNoDuplicate(em, a.organizationId, s, a.nationalId, a.id);
    if (t.fee + t.joiningFee <= 0) {
      await this.members.activateFromApplication(em, a, s, byName, today());
      return;
    }
    const inv = await this.billing.createForApplication(em, s, a, byName);
    await em.getRepository(MemApplication).update({ id: a.id }, { status: 'awaiting_payment', invoiceId: inv.id });
  }

  async cancel(actor: OrgUser, id: string, note: string | null | undefined) {
    if (!note) throw new BadRequestException('اكتب سبب إلغاء الطلب');
    const a = await this.load(actor.organizationId, id);
    if (a.status === 'awaiting_payment' && a.invoiceId) {
      await this.billing.cancel(actor, a.invoiceId, note);
      return this.detail(actor, id);
    }
    if (a.status !== 'in_review' && a.status !== 'returned') throw new ConflictException('لا يُلغى إلا الطلب المفتوح');
    await this.db.getRepository(MemApplication).update({ id }, { status: 'cancelled', approvalLog: [...a.approvalLog, log('إلغاء', 'cancel', actor.fullName, note)] });
    return this.detail(actor, id);
  }

  async documentFile(org: string, id: string, key: string) {
    const a = await this.load(org, id);
    const d = a.documents.find((x) => x.key === key);
    if (!d) throw new NotFoundException('المستند غير موجود');
    return { stream: this.files.open(d.fileKey), mime: d.mime, name: d.fileName };
  }

  // ---------------- العرض ----------------

  async load(org: string, id: string) {
    const a = await this.db.getRepository(MemApplication).findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('الطلب غير موجود');
    return a;
  }

  async list(actor: OrgUser, q: { status?: string; type?: string; search?: string; awaiting?: string; source?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const qb = this.db.getRepository(MemApplication).createQueryBuilder('a').where('a.organization_id = :org', { org });
    if (q.awaiting === '1') qb.andWhere(`a.status = 'in_review'`);
    else if (q.status === 'open') qb.andWhere(`a.status IN ('in_review', 'returned', 'awaiting_payment')`);
    else if (q.status) qb.andWhere('a.status = :status', { status: q.status });
    if (q.type) qb.andWhere('a.type_code = :type', { type: q.type });
    if (q.source) qb.andWhere('a.source = :source', { source: q.source });
    if (q.search?.trim()) qb.andWhere('(a.full_name ILIKE :t OR a.national_id ILIKE :t OR a.mobile ILIKE :t OR a.application_no ILIKE :t)', { t: `%${q.search.trim()}%` });
    const rows = await qb.orderBy('a.created_at', 'DESC').take(500).getMany();
    const out = [];
    for (const a of rows) {
      const stage = a.status === 'in_review' ? a.stages[a.stageIndex] : undefined;
      const canDecide = a.status === 'in_review' && (await this.core.canDecide(actor, stage));
      if (q.awaiting === '1' && !canDecide) continue;
      const t = this.core.type(s, a.typeCode);
      out.push({
        id: a.id, applicationNo: a.applicationNo, fullName: a.fullName, nationalId: a.nationalId, mobile: a.mobile, gender: a.gender, nationality: a.nationality,
        typeCode: a.typeCode, typeName: t?.name ?? a.typeCode, typeColor: t?.color ?? '#94a3b8', status: a.status, statusLabel: APP_STATUS_AR[a.status],
        stageName: stage?.name ?? null, stageIndex: a.stageIndex, stagesCount: a.stages.length, source: a.source, createdAt: a.createdAt, canDecide,
        documents: a.documents.length, memberId: a.memberId,
      });
    }
    return out;
  }

  async detail(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const a = await this.load(org, id);
    const stage = a.status === 'in_review' ? a.stages[a.stageIndex] : undefined;
    const inv = a.invoiceId ? await this.db.getRepository(MemInvoice).findOne({ where: { id: a.invoiceId } }) : null;
    const t = this.core.type(s, a.typeCode);
    const [member] = a.memberId ? await this.db.query('SELECT id, member_no AS "memberNo" FROM mem_members WHERE id = $1', [a.memberId]) : [];
    const manage = actor.isSuperadmin || actor.permissions.includes(P.applications);
    // تنبيهات للمعتمد: ما يخالف شروط النوع وقت المراجعة
    const warnings: string[] = [];
    if (t?.minAge != null && a.birthDate && ageOn(a.birthDate, today()) < t.minAge) warnings.push(`العمر أقل من ${t.minAge} سنة`);
    if (t?.saudiOnly && a.nationality !== 'سعودي') warnings.push('النوع للسعوديين فقط');
    if (a.idExpiry && a.idExpiry < today()) warnings.push('الهوية منتهية الصلاحية');
    for (const r of s.documents.filter((d) => d.isActive && d.required)) if (!a.documents.some((d) => d.key === r.key)) warnings.push(`لم يُرفق ${r.name}`);
    const prior = await this.db.query('SELECT id, member_no AS "memberNo", status, end_date::text AS "endDate" FROM mem_members WHERE organization_id = $1 AND national_id = $2', [org, a.nationalId]);
    if (prior[0] && prior[0].id !== a.memberId) warnings.push(`عضو سابق برقم ${prior[0].memberNo} (تنتهي/انتهت عضويته ${prior[0].endDate})`);
    return {
      id: a.id, applicationNo: a.applicationNo, status: a.status, statusLabel: APP_STATUS_AR[a.status], source: a.source, trackCode: a.trackCode,
      typeCode: a.typeCode, type: t ?? null, ...personFields(a as unknown as ApplicationDto), answers: a.answers,
      documents: a.documents.map((d: StoredDoc) => ({ key: d.key, name: d.name, mime: d.mime, fileName: d.fileName, uploadedAt: d.uploadedAt })),
      acceptedConditions: s.conditions.filter((c) => a.acceptedConditions.includes(c.key)).map((c) => c.text),
      stages: a.stages.map((st, i) => ({
        name: st.name, done: ['awaiting_payment', 'completed'].includes(a.status) || (a.status === 'in_review' && i < a.stageIndex), current: a.status === 'in_review' && i === a.stageIndex,
      })),
      stageName: stage?.name ?? null, approvalLog: a.approvalLog, warnings, createdByName: a.createdByName, createdAt: a.createdAt,
      invoice: inv ? { id: inv.id, invoiceNo: inv.invoiceNo, amount: inv.amount, status: inv.status, statusLabel: INVOICE_STATUS_AR[inv.status], payToken: inv.payToken } : null,
      member: member ?? null,
      can: {
        decide: a.status === 'in_review' && (await this.core.canDecide(actor, stage)),
        edit: manage && a.status === 'returned',
        cancel: manage && ['in_review', 'returned', 'awaiting_payment'].includes(a.status),
      },
    };
  }

  /** متابعة الطلب من الصفحة العامة برقم الطلب ورمز المتابعة */
  async publicTrack(org: string, no: string, code: string) {
    const a = await this.db.getRepository(MemApplication).findOne({ where: { organizationId: org, applicationNo: String(no).trim().toUpperCase() } });
    if (!a || a.trackCode !== String(code).trim().toUpperCase()) throw new NotFoundException('رقم الطلب أو رمز المتابعة غير صحيح');
    const s = await this.core.settings(org);
    const inv = a.invoiceId ? await this.db.getRepository(MemInvoice).findOne({ where: { id: a.invoiceId } }) : null;
    const lastNote = [...a.approvalLog].reverse().find((l) => l.decision === 'return' || l.decision === 'reject');
    const [m] = a.memberId ? await this.db.query('SELECT member_no AS "memberNo", card_code AS "cardCode" FROM mem_members WHERE id = $1', [a.memberId]) : [];
    return {
      id: a.id, applicationNo: a.applicationNo, fullName: a.fullName, typeName: this.core.typeName(s, a.typeCode), status: a.status, statusLabel: APP_STATUS_AR[a.status],
      stageName: a.status === 'in_review' ? a.stages[a.stageIndex]?.name ?? null : null, createdAt: a.createdAt,
      note: a.status === 'returned' || a.status === 'rejected' ? lastNote?.note ?? null : null,
      invoice: inv ? { invoiceNo: inv.invoiceNo, amount: inv.amount, status: inv.status, statusLabel: INVOICE_STATUS_AR[inv.status], payToken: inv.status === 'cancelled' ? null : inv.payToken } : null,
      memberNo: m?.memberNo ?? null,
      // عند الإرجاع يعيد المتقدم تعبئة النموذج ببياناته الحالية
      data: a.status === 'returned' ? {
        ...personFields(a as unknown as ApplicationDto), typeCode: a.typeCode, answers: a.answers, acceptedConditions: a.acceptedConditions,
        documents: a.documents.map((d) => ({ key: d.key, name: d.name, fileName: d.fileName })),
      } : null,
    };
  }

  async publicFind(org: string, no: string, code: string) {
    const a = await this.db.getRepository(MemApplication).findOne({ where: { organizationId: org, applicationNo: String(no).trim().toUpperCase() } });
    if (!a || a.trackCode !== String(code).trim().toUpperCase()) throw new NotFoundException('رقم الطلب أو رمز المتابعة غير صحيح');
    return a;
  }
}
