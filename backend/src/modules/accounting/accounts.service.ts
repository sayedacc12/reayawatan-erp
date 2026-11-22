import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fromCents } from './acc-core.service';
import { AccountDto, AccountUpdateDto, AnalyticDto, AnalyticUpdateDto } from './accounting.dto';
import { buildCompanyChart, COA_NAME, COMPANY_COST_CENTERS } from './coa-company';
import { Account, AccountKind, AccountNature, AnalyticAccount } from './entities/accounting.entity';

export const MAX_LEVELS = 9;
export const NATURE_AR: Record<AccountNature, string> = {
  assets: 'أصول', liabilities: 'خصوم', net_assets: 'حقوق ملكية', expenses: 'مصروفات', revenue: 'إيرادات',
};
export const KIND_AR: Record<AccountKind, string> = { root: 'جذري', main: 'رئيسي', sub: 'فرعي' };

/**
 * الدليل المحاسبي (جذري ← رئيسي ← فرعي، حتى 9 مستويات، والفرعية كلها في مستوى واحد)
 * والحسابات التحليلية (رئيسي وفرعي، حتى 3 مستويات، والتسجيل على الفرعي فقط).
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(AnalyticAccount) private readonly analytics: Repository<AnalyticAccount>,
  ) {}

  // ---------------- الدليل ----------------

  async list(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, moves, s] = await Promise.all([
      this.accounts.find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.db.query(
        `SELECT l.account_id, COUNT(*)::int AS n,
                COALESCE(SUM(CASE WHEN e.status = 'posted' THEN l.debit - l.credit ELSE 0 END), 0) AS bal
           FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
          WHERE l.organization_id = $1 AND e.status <> 'cancelled' GROUP BY l.account_id`, [org]),
      this.core.settings(org),
    ]);
    const mv = new Map<string, { n: number; bal: number }>(moves.map((m: { account_id: string; n: number; bal: string }) => [m.account_id, { n: m.n, bal: cents(m.bal) }]));
    // رصيد كل حساب رئيسي = مجموع أرصدة فروعه
    const bal = new Map<string, number>();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      const b = mv.get(r.id)?.bal ?? 0;
      if (!b) continue;
      let cur: Account | undefined = r;
      while (cur) {
        bal.set(cur.id, (bal.get(cur.id) ?? 0) + b);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return {
      postingLevel: this.postingLevel(rows),
      chartInstalledAt: s.chartInstalledAt,
      chartName: COA_NAME,
      accounts: rows.map((r) => ({
        ...this.view(r), moves: mv.get(r.id)?.n ?? 0, balance: fromCents(bal.get(r.id) ?? 0),
        children: rows.filter((c) => c.parentId === r.id).length,
      })),
    };
  }

  view(a: Account) {
    return {
      id: a.id, code: a.code, name: a.name, kind: a.kind, kindLabel: KIND_AR[a.kind], nature: a.nature, natureLabel: NATURE_AR[a.nature],
      parentId: a.parentId, level: a.level, requiresAnalytic: a.requiresAnalytic, description: a.description, isActive: a.isActive,
    };
  }

  /** مستوى التسجيل: مستوى أول حساب فرعي (كل الفرعية يجب أن تكون فيه) */
  private postingLevel(rows: Pick<Account, 'kind' | 'level' | 'id'>[], exceptId?: string) {
    return rows.find((r) => r.kind === 'sub' && r.id !== exceptId)?.level ?? null;
  }

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const a = await em.getRepository(Account).findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('الحساب غير موجود');
    return a;
  }

  async hasMoves(org: string, accountId: string, em: EntityManager = this.db.manager, includeCancelled = true) {
    const [r] = await em.query(
      `SELECT EXISTS (SELECT 1 FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE l.organization_id = $1 AND l.account_id = $2 ${includeCancelled ? '' : `AND e.status <> 'cancelled'`}) AS x`,
      [org, accountId]);
    return !!r.x;
  }

  private async checkStructure(org: string, em: EntityManager, kind: AccountKind, parentId: string | null | undefined, selfId?: string) {
    let level = 1;
    let parent: Account | null = null;
    if (kind === 'root') {
      if (parentId) throw new BadRequestException('الحساب الجذري لا يكون له حساب أب');
    } else {
      if (!parentId) throw new BadRequestException(`الحساب ${kind === 'main' ? 'الرئيسي' : 'الفرعي'} لا بد أن يكون له حساب أب`);
      parent = await this.find(org, parentId, em);
      if (parent.kind === 'sub') throw new BadRequestException(`الحساب ${parent.code} فرعي، ولا يمكن فتح حساب تحته لا فرعي ولا رئيسي`);
      level = parent.level + 1;
      if (level > MAX_LEVELS) throw new BadRequestException(`الدليل حتى ${MAX_LEVELS} مستويات فقط، ولا يقبل النظام أكثر من ذلك`);
    }
    const all = await em.getRepository(Account).find({ where: { organizationId: org }, select: ['id', 'kind', 'level'] });
    const posting = this.postingLevel(all, selfId);
    if (kind === 'sub' && posting !== null && level !== posting) {
      throw new BadRequestException(`كل الحسابات الفرعية يجب أن تكون في المستوى نفسه للتسجيل (المستوى ${posting})، وهذا الحساب في المستوى ${level}`);
    }
    if (kind !== 'sub' && posting !== null && level >= posting) {
      throw new BadRequestException(`الحسابات الفرعية في المستوى ${posting}، فالحساب ${kind === 'root' ? 'الجذري' : 'الرئيسي'} يجب أن يكون في مستوى أعلى منه`);
    }
    if (kind === 'main' && level === MAX_LEVELS) throw new BadRequestException(`المستوى ${MAX_LEVELS} هو الأخير، فلا يكون الحساب فيه إلا فرعيًا`);
    return { level, parent };
  }

  private async assertCodeFree(org: string, code: string, em: EntityManager, selfId?: string) {
    const other = await em.getRepository(Account).findOne({ where: { organizationId: org, code } });
    if (other && other.id !== selfId) throw new ConflictException(`رقم الحساب ${code} مستخدم من قبل للحساب «${other.name}»، ولا يمكن تكرار رقم حساب مرتين`);
  }

  async create(actor: OrgUser, dto: AccountDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await this.assertCodeFree(org, dto.code, em);
      const { level } = await this.checkStructure(org, em, dto.kind, dto.parentId);
      const a = await em.getRepository(Account).save(em.create(Account, {
        organizationId: org, code: dto.code, name: dto.name, kind: dto.kind, nature: dto.nature, parentId: dto.kind === 'root' ? null : dto.parentId!,
        level, requiresAnalytic: dto.kind === 'sub' ? !!dto.requiresAnalytic : false, description: dto.description ?? null, isActive: dto.isActive ?? true,
      }));
      return this.view(a);
    });
  }

  async update(actor: OrgUser, id: string, dto: AccountUpdateDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const a = await this.find(org, id, em);
      const moves = await this.hasMoves(org, id, em);
      const children = await em.getRepository(Account).count({ where: { organizationId: org, parentId: id } });
      if (dto.code && dto.code !== a.code) {
        if (moves) throw new ConflictException('لا يمكن تغيير رقم حساب عليه معاملات محاسبية');
        await this.assertCodeFree(org, dto.code, em, id);
        a.code = dto.code;
      }
      if (dto.kind && dto.kind !== a.kind) {
        if (moves) throw new ConflictException('لا يمكن تغيير نوع حساب عليه معاملات محاسبية');
        if (children) throw new ConflictException('لا يمكن تغيير نوع حساب تحته حسابات');
        if ((dto.kind === 'root') !== (a.kind === 'root')) throw new BadRequestException('لا يمكن تحويل حساب جذري إلى غير جذري أو العكس');
        await this.checkStructure(org, em, dto.kind, a.parentId, id);
        a.kind = dto.kind;
      }
      if (dto.nature && dto.nature !== a.nature) {
        if (moves) throw new ConflictException('لا يمكن تغيير طبيعة حساب عليه معاملات محاسبية');
        a.nature = dto.nature;
      }
      if (dto.isActive === false && a.isActive && a.kind === 'sub' && (await this.hasMoves(org, id, em, false))) {
        throw new ConflictException('لا يمكن إلغاء حساب فرعي عليه معاملات محاسبية');
      }
      if (dto.name !== undefined) a.name = dto.name;
      if (dto.description !== undefined) a.description = dto.description;
      if (dto.isActive !== undefined) a.isActive = dto.isActive;
      if (dto.requiresAnalytic !== undefined) a.requiresAnalytic = a.kind === 'sub' && dto.requiresAnalytic;
      await em.save(a);
      return this.view(a);
    });
  }

  async remove(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const a = await this.find(org, id, em);
      if (await em.getRepository(Account).exist({ where: { organizationId: org, parentId: id } })) {
        throw new ConflictException('احذف الحسابات التي تحت هذا الحساب أولًا');
      }
      if (await this.hasMoves(org, id, em)) throw new ConflictException('لا يمكن إلغاء حساب عليه معاملات محاسبية');
      const [used] = await em.query(
        `SELECT (SELECT COUNT(*) FROM acc_cash_accounts WHERE gl_account_id = $1) + (SELECT COUNT(*) FROM acc_warehouses WHERE gl_account_id = $1)
              + (SELECT COUNT(*) FROM pr_warehouses WHERE gl_account_id = $1) + (SELECT COUNT(*) FROM pr_item_groups WHERE inventory_account_id = $1 OR expense_account_id = $1)
              + (SELECT COUNT(*) FROM pr_items WHERE inventory_account_id = $1 OR expense_account_id = $1) + (SELECT COUNT(*) FROM pr_settings WHERE payables_account_id = $1)
              + (SELECT COUNT(*) FROM acc_partners WHERE account_id = $1) + (SELECT COUNT(*) FROM acc_settings WHERE closing_account_id = $1) AS n`, [id]);
      if (Number(used.n)) throw new ConflictException(`الحساب ${a.code} مرتبط ببنك أو صندوق أو مستودع أو مجموعة أصناف أو صنف أو شريك أو بإعدادات الإقفال أو المشتريات، فك الربط أولًا`);
      await em.delete(Account, { id });
    });
  }

  /** حساب صالح للتسجيل في القيود: فرعي ونشط */
  async postable(org: string, id: string, em: EntityManager = this.db.manager) {
    const a = await this.find(org, id, em);
    if (a.kind !== 'sub') throw new BadRequestException(`الحساب ${a.code} «${a.name}» ليس حسابًا فرعيًا، والتسجيل على الحسابات الفرعية فقط`);
    if (!a.isActive) throw new BadRequestException(`الحساب ${a.code} «${a.name}» موقوف`);
    return a;
  }

  // ---------------- تنصيب دليل الشركات ----------------

  async chartInfo(actor: OrgUser) {
    const org = actor.organizationId;
    const chart = buildCompanyChart();
    const [s, count] = await Promise.all([this.core.settings(org), this.accounts.count({ where: { organizationId: org } })]);
    return {
      name: COA_NAME, accounts: chart.length, postingAccounts: chart.filter((a) => a.kind === 'sub').length, levels: 6,
      installedAt: s.chartInstalledAt, canInstall: count === 0, existingAccounts: count,
    };
  }

  /** تنصيب دليل حسابات الشركات (في بداية الإعداد فقط والدليل فارغ؛ متى بدأ المستخدم دليلًا يدويًا يتوقف هذا الزر) */
  async installChart(actor: OrgUser) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      if (await em.getRepository(Account).exist({ where: { organizationId: org } })) {
        throw new ConflictException('الدليل المحاسبي فيه حسابات بالفعل. تنصيب دليل الشركات الجاهز متاح في بداية الإعداد فقط والدليل فارغ');
      }
      const chart = buildCompanyChart();
      const ids = new Map<string, string>();
      // الإدراج مستوى بعد مستوى (الآباء قبل الأبناء) وعلى دفعات
      const levels = [...new Set(chart.map((c) => c.level))].sort((a, b) => a - b);
      for (const lvl of levels) for (let i = 0, rows = chart.filter((c) => c.level === lvl); i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const saved = await em.getRepository(Account).save(batch.map((c) => em.create(Account, {
          organizationId: org, code: c.code, name: c.name, kind: c.kind, nature: c.nature, level: c.level,
          parentId: c.parentCode ? ids.get(c.parentCode)! : null,
          // تعليمات الدليل: كل قيد مصروفات يُحمَّل على مركز تكلفة
          requiresAnalytic: c.kind === 'sub' && c.nature === 'expenses', isActive: true,
        })));
        saved.forEach((a) => ids.set(a.code, a.id));
      }
      // مراكز التكلفة حسب أنشطة الشركة
      const repo = em.getRepository(AnalyticAccount);
      let main = await repo.findOne({ where: { organizationId: org, code: COMPANY_COST_CENTERS.main.code } });
      if (!main) main = await repo.save(repo.create({ organizationId: org, code: COMPANY_COST_CENTERS.main.code, name: COMPANY_COST_CENTERS.main.name, kind: 'main', level: 1, parentId: null }));
      for (const c of COMPANY_COST_CENTERS.subs) {
        if (!(await repo.exist({ where: { organizationId: org, code: c.code } }))) {
          await repo.save(repo.create({ organizationId: org, code: c.code, name: c.name, kind: 'sub', level: 2, parentId: main.id }));
        }
      }
      // حساب إقفال النتائج الافتراضي: الأرباح المبقاة
      const closing = ids.get('2310100101') ?? null;
      await this.core.settings(org, em);
      await em.update('acc_settings', { organizationId: org }, { chartInstalledAt: new Date(), ...(closing ? { closingAccountId: closing } : {}) });
      return { installed: chart.length, postingAccounts: chart.filter((a) => a.kind === 'sub').length };
    });
  }

  // ---------------- الحسابات التحليلية ----------------

  async listAnalytic(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, usage, s] = await Promise.all([
      this.analytics.find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.db.query(
        `SELECT a->>'analyticId' AS id, COUNT(*)::int AS n FROM acc_entry_lines l, jsonb_array_elements(l.analytic) a
          WHERE l.organization_id = $1 GROUP BY 1`, [org]),
      this.core.settings(org),
    ]);
    const used = new Map<string, number>(usage.map((u: { id: string; n: number }) => [u.id, u.n]));
    return {
      levels: s.analyticLevels,
      accounts: rows.map((r) => ({ ...this.analyticView(r), moves: used.get(r.id) ?? 0, children: rows.filter((c) => c.parentId === r.id).length })),
    };
  }

  analyticView(a: AnalyticAccount) {
    return { id: a.id, code: a.code, name: a.name, kind: a.kind, parentId: a.parentId, level: a.level, description: a.description, isActive: a.isActive };
  }

  async createAnalytic(actor: OrgUser, dto: AnalyticDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const repo = em.getRepository(AnalyticAccount);
      const other = await repo.findOne({ where: { organizationId: org, code: dto.code } });
      if (other) throw new ConflictException(`الرمز ${dto.code} مستخدم للحساب التحليلي «${other.name}»`);
      const { analyticLevels } = await this.core.settings(org, em);
      let level = 1;
      if (dto.kind === 'sub' && !dto.parentId) throw new BadRequestException('الحساب التحليلي الفرعي لا بد أن يكون تحت حساب رئيسي');
      if (dto.parentId) {
        const parent = await repo.findOne({ where: { id: dto.parentId, organizationId: org } });
        if (!parent) throw new NotFoundException('الحساب التحليلي الأب غير موجود');
        if (parent.kind === 'sub') throw new BadRequestException('لا يمكن فتح حساب تحليلي تحت حساب فرعي');
        level = parent.level + 1;
      }
      if (level > analyticLevels) {
        throw new BadRequestException(`الحسابات التحليلية حتى ${analyticLevels} مستويات فقط (${analyticLevels === 3 ? 'رئيسي ورئيسي وفرعي' : 'رئيسي وفرعي'})`);
      }
      if (dto.kind === 'main' && level === analyticLevels) throw new BadRequestException(`المستوى ${level} هو الأخير، فلا يكون الحساب التحليلي فيه إلا فرعيًا`);
      const a = await repo.save(repo.create({
        organizationId: org, code: dto.code, name: dto.name, kind: dto.kind, parentId: dto.parentId ?? null, level,
        description: dto.description ?? null, isActive: dto.isActive ?? true,
      }));
      return this.analyticView(a);
    });
  }

  private async analyticUsed(org: string, id: string, em: EntityManager = this.db.manager) {
    const [r] = await em.query(
      `SELECT EXISTS (SELECT 1 FROM acc_entry_lines WHERE organization_id = $1 AND analytic @> $2::jsonb) AS x`,
      [org, JSON.stringify([{ analyticId: id }])]);
    return !!r.x;
  }

  async updateAnalytic(actor: OrgUser, id: string, dto: AnalyticUpdateDto) {
    const org = actor.organizationId;
    const a = await this.analytics.findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('الحساب التحليلي غير موجود');
    if (dto.code && dto.code !== a.code) {
      const other = await this.analytics.findOne({ where: { organizationId: org, code: dto.code } });
      if (other) throw new ConflictException(`الرمز ${dto.code} مستخدم للحساب التحليلي «${other.name}»`);
      a.code = dto.code;
    }
    if (dto.name !== undefined) a.name = dto.name;
    if (dto.description !== undefined) a.description = dto.description;
    if (dto.isActive !== undefined) a.isActive = dto.isActive;
    await this.analytics.save(a);
    return this.analyticView(a);
  }

  async removeAnalytic(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const a = await this.analytics.findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('الحساب التحليلي غير موجود');
    if (await this.analytics.exist({ where: { organizationId: org, parentId: id } })) throw new ConflictException('احذف الحسابات التحليلية التي تحته أولًا');
    if (await this.analyticUsed(org, id)) throw new ConflictException('لا يمكن حذف حساب تحليلي مستخدم في قيود، يمكنك إيقافه بدلًا من ذلك');
    await this.analytics.delete({ id });
  }

  async analyticPostable(org: string, id: string, em: EntityManager = this.db.manager) {
    const a = await em.getRepository(AnalyticAccount).findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('الحساب التحليلي غير موجود');
    if (a.kind !== 'sub') throw new BadRequestException(`الحساب التحليلي «${a.name}» رئيسي، والتسجيل على الحسابات التحليلية الفرعية فقط`);
    if (!a.isActive) throw new BadRequestException(`الحساب التحليلي «${a.name}» موقوف`);
    return a;
  }

  async setAnalyticLevels(org: string, levels: number) {
    if (levels === 2) {
      const [r] = await this.db.query('SELECT COUNT(*)::int AS n FROM acc_analytic_accounts WHERE organization_id = $1 AND level = 3', [org]);
      if (r.n) throw new ConflictException('توجد حسابات تحليلية في المستوى الثالث، لا يمكن تقليل المستويات إلى 2');
    }
  }
}
