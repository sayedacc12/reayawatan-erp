import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Role, User } from '../../core/entities';
import { normalizeDonorFields } from './donor-fields';
import {
  AccountRef, ApprovalStage, BankAccount, DEFAULT_ROUTING, DonorLevel, FundraisingSettings, JournalRouting, SupportManager, WaqfProject,
} from './entities';
import { BankAccountDto, DonorLevelDto, GeneralSettingsDto, StagesDto, SupportManagerDto, WaqfProjectDto } from './settings.dto';

type ListEntity = typeof DonorLevel | typeof SupportManager | typeof BankAccount | typeof WaqfProject;
const LISTS = { levels: DonorLevel, managers: SupportManager, banks: BankAccount, waqf: WaqfProject } as const;
export type ListName = keyof typeof LISTS;

const IN_USE: Record<ListName, { sql: string; message: string }> = {
  levels: { sql: 'SELECT 1 FROM fundraising_donors WHERE level_id = $1 LIMIT 1', message: 'يوجد داعمون في هذا المستوى. انقلهم لمستوى آخر أولًا' },
  managers: { sql: 'SELECT 1 FROM fundraising_donors WHERE support_manager_id = $1 UNION ALL SELECT 1 FROM fundraising_opportunities WHERE support_manager_id = $1 LIMIT 1', message: 'مدير الدعم مرتبط بداعمين أو فرص، لذا أوقفه بدلًا من حذفه' },
  banks: { sql: 'SELECT 1 FROM fundraising_opportunities WHERE bank_account_id = $1 UNION ALL SELECT 1 FROM fundraising_pledge_collections WHERE bank_account_id = $1 LIMIT 1', message: 'الحساب مستخدم في فرص تبرع، لذا أوقفه بدلًا من حذفه' },
  waqf: { sql: 'SELECT 1 FROM fundraising_batches WHERE waqf_project_id = $1 LIMIT 1', message: 'المشروع عليه دفعات، لذا أوقفه بدلًا من حذفه' },
};

const acc = (v: unknown, fallback: AccountRef): AccountRef => {
  const o = (v ?? {}) as Record<string, unknown>;
  const code = typeof o.code === 'string' ? o.code.trim().slice(0, 50) || null : fallback.code;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 200) || null : fallback.name;
  return { code, name };
};
const desc = (v: unknown, fallback: string | null) => {
  const o = (v ?? {}) as Record<string, unknown>;
  return typeof o.description === 'string' ? o.description.trim().slice(0, 300) || null : fallback;
};

/** إعدادات الموارد المالية: الحقول المرنة، المستويات، مدراء الدعم، الحسابات البنكية، الأوقاف، مراحل الاعتماد، التوجيه المحاسبي */
@Injectable()
export class FundraisingSettingsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(FundraisingSettings) private readonly settings: Repository<FundraisingSettings>,
    @InjectRepository(ApprovalStage) private readonly stages: Repository<ApprovalStage>,
  ) {}

  async general(orgId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(FundraisingSettings) : this.settings;
    const s = await repo.findOne({ where: { organizationId: orgId } });
    return {
      donorFields: s?.donorFields ?? [],
      journalRouting: this.routing(s?.journalRouting ?? null),
    };
  }

  /** دمج التوجيه المحفوظ مع الافتراضي حتى لا يكون أي طرف ناقصًا */
  routing(saved: JournalRouting | null): JournalRouting {
    const s = (saved ?? {}) as Partial<JournalRouting>;
    const d = DEFAULT_ROUTING;
    const c = (s.credit ?? {}) as Partial<JournalRouting['credit']>;
    return {
      cash: { description: desc(s.cash, d.cash.description) },
      inKind: { debit: acc(s.inKind?.debit, d.inKind.debit), description: desc(s.inKind, d.inKind.description) },
      pledge: { debit: acc(s.pledge?.debit, d.pledge.debit), description: desc(s.pledge, d.pledge.description) },
      pledgeCollection: { description: desc(s.pledgeCollection, d.pledgeCollection.description) },
      credit: {
        operational: acc(c.operational, d.credit.operational), restricted: acc(c.restricted, d.credit.restricted),
        zakat: acc(c.zakat, d.credit.zakat), waqf: acc(c.waqf, d.credit.waqf), case: acc(c.case, d.credit.case),
      },
    };
  }

  async updateGeneral(actor: OrgUser, dto: GeneralSettingsDto) {
    const current = await this.settings.findOne({ where: { organizationId: actor.organizationId } })
      ?? this.settings.create({ organizationId: actor.organizationId, donorFields: [], journalRouting: null });
    if (dto.donorFields !== undefined) {
      const next = normalizeDonorFields(dto.donorFields);
      // الحقل المحذوف من الإعدادات يتحول لموقوف حتى لا تضيع بياناته عند الداعمين
      for (const old of current.donorFields) {
        if (!next.some((f) => f.key === old.key)) next.push({ ...old, isActive: false });
      }
      current.donorFields = next;
    }
    if (dto.journalRouting !== undefined) current.journalRouting = this.routing(dto.journalRouting as unknown as JournalRouting);
    await this.settings.save(current);
    return this.general(actor.organizationId);
  }

  users(orgId: string): Promise<{ id: string; fullName: string }[]> {
    return this.db.query('SELECT id, full_name AS "fullName" FROM users WHERE organization_id = $1 AND is_active ORDER BY full_name', [orgId]);
  }

  roles(orgId: string): Promise<{ id: string; name: string }[]> {
    return this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [orgId]);
  }

  // ---------------- القوائم ----------------

  async all(actor: OrgUser) {
    const org = actor.organizationId;
    const [general, levels, managers, banks, waqf, stages] = await Promise.all([
      this.general(org),
      this.db.getRepository(DonorLevel).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.db.getRepository(SupportManager).find({ where: { organizationId: org }, relations: { user: true }, order: { name: 'ASC' } }),
      this.db.getRepository(BankAccount).find({ where: { organizationId: org }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(WaqfProject).find({ where: { organizationId: org }, order: { createdAt: 'ASC' } }),
      this.listStages(org),
    ]);
    return {
      ...general, levels, banks, waqf, stages,
      managers: managers.map((m) => ({ ...m, user: undefined, userName: m.user?.fullName ?? null })),
    };
  }

  async createItem(actor: OrgUser, list: ListName, dto: DonorLevelDto | SupportManagerDto | BankAccountDto | WaqfProjectDto) {
    const Entity = LISTS[list] as ListEntity;
    await this.check(actor, list, dto);
    const repo = this.db.getRepository(Entity);
    return repo.save(repo.create({ ...dto, organizationId: actor.organizationId } as object));
  }

  async updateItem(actor: OrgUser, list: ListName, id: string, dto: DonorLevelDto | SupportManagerDto | BankAccountDto | WaqfProjectDto) {
    const Entity = LISTS[list] as ListEntity;
    const repo = this.db.getRepository(Entity);
    const row = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!row) throw new NotFoundException('العنصر غير موجود');
    await this.check(actor, list, dto, id);
    Object.assign(row, dto);
    return repo.save(row);
  }

  async removeItem(actor: OrgUser, list: ListName, id: string) {
    const Entity = LISTS[list] as ListEntity;
    const repo = this.db.getRepository(Entity);
    const row = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!row) throw new NotFoundException('العنصر غير موجود');
    const [used] = await this.db.query(IN_USE[list].sql, [id]);
    if (used) throw new ConflictException(IN_USE[list].message);
    await repo.delete({ id });
  }

  private async check(actor: OrgUser, list: ListName, dto: object, id?: string) {
    if (list === 'managers') {
      const m = dto as SupportManagerDto;
      if (m.kind === 'employee') {
        if (m.userId) {
          const u = await this.db.getRepository(User).findOne({ where: { id: m.userId, organizationId: actor.organizationId } });
          if (!u) throw new BadRequestException('الموظف غير موجود في الجمعية');
        }
        m.entityName = null;
      } else {
        m.userId = null;
        if (!m.entityName) throw new BadRequestException('اكتب اسم الجهة الخارجية');
      }
    }
    if (list === 'banks') {
      const b = dto as BankAccountDto;
      const [dup] = await this.db.query(
        'SELECT 1 FROM fundraising_bank_accounts WHERE organization_id = $1 AND account_number = $2 AND id <> $3',
        [actor.organizationId, b.accountNumber, id ?? '00000000-0000-0000-0000-000000000000'],
      );
      if (dup) throw new ConflictException('رقم الحساب مسجل من قبل');
    }
  }

  // ---------------- مراحل الاعتماد ----------------

  async listStages(orgId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(ApprovalStage) : this.stages;
    const rows = await repo.find({ where: { organizationId: orgId }, relations: { role: true }, order: { sortOrder: 'ASC' } });
    return rows.map((s) => ({ ...s, role: undefined, roleName: s.role?.name ?? null }));
  }

  /**
   * حفظ المراحل كلها بترتيبها. المرحلة التي عليها فرص قيد الاعتماد لا تُحذف.
   */
  async saveStages(actor: OrgUser, dto: StagesDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      for (const s of dto.stages) {
        if (s.roleId && !(await em.exists(Role, { where: { id: s.roleId, organizationId: org } }))) {
          throw new BadRequestException(`الدور المحدد في مرحلة "${s.name}" غير موجود`);
        }
      }
      const existing = await em.find(ApprovalStage, { where: { organizationId: org } });
      const keep = new Set(dto.stages.map((s) => s.id).filter(Boolean));
      for (const old of existing) {
        if (keep.has(old.id)) continue;
        const [busy] = await em.query(
          "SELECT 1 FROM fundraising_opportunities WHERE current_stage_id = $1 AND status = 'in_progress' LIMIT 1", [old.id],
        );
        if (busy) throw new ConflictException(`توجد فرص في مرحلة "${old.name}" بانتظار القرار، لذا لا يمكن حذفها الآن`);
        await em.delete(ApprovalStage, { id: old.id });
      }
      for (const [i, s] of dto.stages.entries()) {
        const row = (s.id && existing.find((e) => e.id === s.id)) || em.create(ApprovalStage, { organizationId: org });
        Object.assign(row, {
          name: s.name, instructions: s.instructions ?? null, roleId: s.roleId ?? null, sortOrder: i + 1,
          canReject: s.canReject ?? true, canReturn: s.canReturn ?? true,
        });
        await em.save(row);
      }
    });
    return this.listStages(org);
  }
}
