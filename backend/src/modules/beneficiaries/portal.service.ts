import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { Organization } from '../../core/entities';
import { Activity, Beneficiary, BeneficiaryRequest, DynamicForm, Workflow } from './entities';
import { PortalLoginDto, PortalProfileDto, PortalRegisterDto, PortalRequestDto, TicketDto } from './portal.dto';
import { PortalUser } from './portal.guard';
import { RECURRENCE_LABEL, RequestsService } from './requests.service';
import { TicketsService } from './tickets.service';

const DUMMY_HASH = bcrypt.hashSync('portal-timing-equalizer', 10);

/** بوابة المستفيدين: التسجيل والدخول برقم الهوية، تقديم الطلبات ومتابعتها، والرسائل */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: DataSource,
    private readonly jwt: JwtService,
    @InjectRepository(Beneficiary) private readonly beneficiaries: Repository<Beneficiary>,
    private readonly requests: RequestsService,
    private readonly tickets: TicketsService,
  ) {}

  async organization(slug: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: slug.toLowerCase(), isActive: true } });
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    return org;
  }

  async info(slug: string) {
    const org = await this.organization(slug);
    return { name: org.name, slug: org.slug, projects: await this.projects(org.id) };
  }

  /**
   * المشاريع المتاحة للتقديم مع محورها وبرنامجها ونموذج بيانات الطلب وقواعد الدعم.
   * مع beneficiaryId: بيوضح لكل مشروع المستفيد يقدر يقدم دلوقتي ولا لأ وليه.
   */
  async projects(organizationId: string, beneficiaryId?: string) {
    const all = await this.db.getRepository(Activity).find({ where: { organizationId, isActive: true }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const byId = new Map(all.map((a) => [a.id, a]));
    const workflows = await this.db.getRepository(Workflow).find({ where: { organizationId } });
    const forms = await this.db.getRepository(DynamicForm).find({ where: { organizationId } });
    const def = workflows.find((w) => w.isDefault);
    const list = all
      .filter((p) => p.level === 'project' && p.portalVisible)
      // لازم البرنامج والمحور نشطين كمان
      .filter((p) => byId.has(p.parentId!) && byId.has(byId.get(p.parentId!)!.parentId!))
      .map((p) => {
        const program = byId.get(p.parentId!)!;
        const axis = byId.get(program.parentId!)!;
        const wf = workflows.find((w) => w.id === p.workflowId) ?? def;
        // نموذج التقديم بيظهر للمستفيد بعد اعتماده بس
        const form = wf?.applicationFormId ? forms.find((f) => f.id === wf.applicationFormId && f.status === 'approved') : null;
        return {
          id: p.id, name: p.name, description: p.description, program: program.name, axis: axis.name,
          applicationForm: form ? { name: form.name, fields: form.fields } : null,
          services: p.services, multiServices: p.multiServices, allowConcurrent: p.allowConcurrent,
          recurrence: p.recurrence, recurrenceLabel: RECURRENCE_LABEL[p.recurrence],
          eligibility: null as null | { canApply: boolean; reason: string | null; nextDate: string | null },
          project: p,
        };
      });
    for (const item of list) {
      if (beneficiaryId) item.eligibility = await this.requests.eligibility(this.db.manager, organizationId, beneficiaryId, item.project);
    }
    return list.map(({ project: _p, ...rest }) => rest);
  }

  async register(slug: string, dto: PortalRegisterDto) {
    const org = await this.organization(slug);
    const existing = await this.beneficiaries.findOne({ where: { organizationId: org.id, nationalId: dto.nationalId } });
    if (existing) {
      throw new ConflictException('رقم الهوية مسجل لدى الجمعية بالفعل. لو عندك حساب ادخل بيه، أو تواصل مع الجمعية لتفعيل حسابك');
    }
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`beneficiaries:${org.id}`]);
      const [{ next }] = await em.query(
        'SELECT COALESCE(MAX(file_no), 0) + 1 AS next FROM beneficiaries WHERE organization_id = $1', [org.id],
      );
      const b = await em.save(em.create(Beneficiary, {
        organizationId: org.id, fileNo: Number(next), fullName: dto.fullName, nationalId: dto.nationalId, phone: dto.phone,
        gender: dto.gender, birthDate: dto.birthDate ?? null, city: dto.city ?? null,
        category: (dto.category as Beneficiary['category']) ?? 'other', status: 'new', monthlyIncome: 0, source: 'portal',
        portalPasswordHash: await bcrypt.hash(dto.password, 12),
      }));
      return b.id;
    });
    return this.issue(id);
  }

  async login(slug: string, dto: PortalLoginDto) {
    const org = await this.organization(slug);
    const nationalId = dto.nationalId.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    const b = await this.beneficiaries.findOne({
      where: { organizationId: org.id, nationalId },
      select: { id: true, portalPasswordHash: true },
    });
    const ok = await bcrypt.compare(dto.password, b?.portalPasswordHash ?? DUMMY_HASH);
    if (!b?.portalPasswordHash || !ok) throw new UnauthorizedException('رقم الهوية أو كلمة المرور غير صحيحة');
    await this.beneficiaries.update(b.id, { portalLastLoginAt: new Date() });
    return this.issue(b.id);
  }

  async me(p: PortalUser) {
    const b = await this.beneficiaries.findOneOrFail({ where: { id: p.beneficiaryId } });
    const org = await this.db.getRepository(Organization).findOneOrFail({ where: { id: p.organizationId } });
    return {
      organization: { name: org.name, slug: org.slug },
      profile: {
        fullName: b.fullName, fileNo: b.fileNo, nationalId: b.nationalId, phone: b.phone, altPhone: b.altPhone,
        city: b.city, address: b.address, gender: b.gender, status: b.status,
      },
    };
  }

  async updateProfile(p: PortalUser, dto: PortalProfileDto) {
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (patch.phone === null) throw new BadRequestException('رقم الموبايل مطلوب');
    if (Object.keys(patch).length) await this.beneficiaries.update(p.beneficiaryId, patch);
    return this.me(p);
  }

  async myRequests(p: PortalUser) {
    const rows = await this.db.getRepository(BeneficiaryRequest).find({
      where: { organizationId: p.organizationId, beneficiaryId: p.beneficiaryId },
      relations: { project: true, currentStage: true },
      order: { createdAt: 'DESC' },
    });
    const totals: { workflow_id: string; count: number }[] = await this.db.query(
      'SELECT workflow_id, COUNT(*)::int AS count FROM workflow_stages WHERE organization_id = $1 GROUP BY workflow_id',
      [p.organizationId],
    );
    const stageCount = new Map(totals.map((t) => [t.workflow_id, t.count]));
    return rows.map((r) => ({
      id: r.id, requestNo: r.requestNo, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
      project: r.project!.name,
      stage: r.currentStage?.name ?? null,
      stageIndex: r.currentStage?.sortOrder ?? null,
      stageCount: stageCount.get(r.workflowId) ?? 0,
      contributionStatus: r.contributionStatus,
    }));
  }

  /** تفاصيل طلب للمستفيد: بدون بيانات النماذج الداخلية للموظفين */
  async request(p: PortalUser, id: string) {
    const r = await this.requests.get(p.organizationId, id, p.beneficiaryId);
    return {
      ...r,
      beneficiary: undefined,
      // نتيجة البحث الداخلية مش بتظهر للمستفيد، بيظهر له المطلوب منه بس
      research: undefined,
      contribution: { ...r.contribution, journal: undefined },
      workflow: r.workflow && {
        ...r.workflow,
        stages: r.workflow.stages.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, kind: s.kind })),
      },
      actions: r.actions.map((a) => ({
        id: a.id, stageName: a.stageName, decision: a.decision, createdAt: a.createdAt,
        // المستفيد يشوف أسباب الرفض والإرجاع، أما ملاحظات القبول الداخلية فلا
        notes: ['reject', 'return', 'resubmitted', 'contribution_sent'].includes(a.decision) ? a.notes : null,
        actorName: ['submitted', 'resubmitted', 'cancelled', 'contribution_sent'].includes(a.decision) ? a.actorName : 'الجمعية',
      })),
    };
  }

  async submitRequest(p: PortalUser, dto: PortalRequestDto) {
    const id = await this.requests.create(this.actor(p), { ...dto, beneficiaryId: p.beneficiaryId }, 'portal');
    return this.request(p, id);
  }

  async resubmit(p: PortalUser, id: string, dto: { description?: string | null; applicationData?: Record<string, unknown>; notes?: string | null }) {
    await this.requests.resubmit(this.actor(p), id, dto, p.beneficiaryId);
    return this.request(p, id);
  }

  async submitContribution(p: PortalUser, id: string, amount: number, file: Express.Multer.File) {
    await this.requests.submitContribution(this.actor(p), id, p.beneficiaryId, amount, file);
    return this.request(p, id);
  }

  async cancel(p: PortalUser, id: string) {
    await this.requests.cancel(this.actor(p), id, p.beneficiaryId);
    return this.request(p, id);
  }

  listTickets(p: PortalUser) {
    return this.tickets.listForBeneficiary(p.organizationId, p.beneficiaryId);
  }

  createTicket(p: PortalUser, dto: TicketDto) {
    return this.tickets.create(p.organizationId, p.beneficiaryId, dto);
  }

  private actor(p: PortalUser) {
    return { organizationId: p.organizationId, userId: null, name: p.fullName };
  }

  private async issue(beneficiaryId: string) {
    return { accessToken: await this.jwt.signAsync({ sub: beneficiaryId, typ: 'portal' }, { expiresIn: '7d' }) };
  }
}
