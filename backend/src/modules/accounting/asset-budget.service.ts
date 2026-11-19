import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fromCents } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { amountOf, AssetsService, bad, idOf, MOVE_AR, optId, str } from './assets.service';
import { CapitalBudget, CapitalBudgetLine } from './entities/assets.entity';

const r2 = (n: number) => fromCents(cents(n));
/** عمليات الإنفاق الرأسمالي التي تُقارن بالموازنة */
const CAPEX = ['purchase', 'addition', 'wip'];

/**
 * الموازنة الرأسمالية: بنود مخطط شراؤها لكل سنة مالية حسب مجموعة الأصول، تُعتمد ثم تُربط بها عمليات الشراء والإضافة والدفعات تحت التنفيذ.
 * المقارنة: المخطط مقابل الملتزم به (سندات تنتظر الاعتماد) والفعلي (معتمد)، والإنفاق غير المدرج في الموازنة لكل مجموعة.
 * حقل external_ref في الرأس والبنود مخصص للربط مستقبلًا مع نظام الخطة والموازنة.
 */
@Injectable()
export class AssetBudgetService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly assets: AssetsService,
  ) {}

  async list(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT b.id, b.title, b.status, b.external_ref, b.created_by_name, b.approved_by_name, b.approved_at, y.id AS year_id, y.name AS year,
              to_char(y.start_date, 'YYYY-MM-DD') AS start, to_char(y.end_date, 'YYYY-MM-DD') AS "end",
              (SELECT COUNT(*) FROM acc_asset_budget_lines l WHERE l.budget_id = b.id)::int AS lines,
              COALESCE((SELECT SUM(amount) FROM acc_asset_budget_lines l WHERE l.budget_id = b.id), 0) AS planned,
              COALESCE((SELECT SUM(m.amount) FROM acc_asset_moves m JOIN acc_asset_budget_lines l ON l.id = m.budget_line_id WHERE l.budget_id = b.id AND m.status = 'done'), 0) AS actual,
              COALESCE((SELECT SUM(m.amount) FROM acc_asset_moves m JOIN acc_asset_budget_lines l ON l.id = m.budget_line_id WHERE l.budget_id = b.id AND m.status = 'pending'), 0) AS committed
         FROM acc_asset_budgets b JOIN acc_fiscal_years y ON y.id = b.fiscal_year_id WHERE b.organization_id = $1 ORDER BY y.start_date DESC`, [org]);
    return rows.map((r) => ({
      id: r.id, title: r.title, status: r.status, statusLabel: r.status === 'approved' ? 'معتمدة' : 'مسودة', externalRef: r.external_ref,
      year: { id: r.year_id, name: r.year, start: r.start, end: r.end }, lines: r.lines, planned: Number(r.planned), actual: Number(r.actual), committed: Number(r.committed),
      remaining: r2(Number(r.planned) - Number(r.actual) - Number(r.committed)), createdByName: r.created_by_name, approvedByName: r.approved_by_name, approvedAt: r.approved_at,
    }));
  }

  /** الموازنة ببنودها والفعلي لكل بند، والإنفاق غير المدرج في الموازنة لكل مجموعة */
  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const head = (await this.list(actor)).find((b) => b.id === id);
    if (!head) throw new NotFoundException('الموازنة غير موجودة');
    const b = await this.db.getRepository(CapitalBudget).findOneByOrFail({ id });
    const lines = await this.db.getRepository(CapitalBudgetLine).find({ where: { budgetId: id }, order: { lineNo: 'ASC' } });
    const groups: { id: string; name: string; code: string }[] = await this.db.query('SELECT id, name, code FROM acc_asset_groups WHERE organization_id = $1 ORDER BY sort_order', [org]);
    const units = await this.assets.units(org);
    const moves: Record<string, string | number | null>[] = await this.db.query(
      `SELECT m.id, m.kind, m.status, m.amount, to_char(m.date, 'YYYY-MM-DD') AS date, m.budget_line_id, a.id AS asset_id, a.code, a.name, a.group_id
         FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id
        WHERE m.organization_id = $1 AND m.kind = ANY($2) AND m.status <> 'cancelled' AND m.date BETWEEN $3 AND $4 ORDER BY m.date`,
      [org, CAPEX, head.year.start, head.year.end]);
    const sum = (xs: Record<string, string | number | null>[], st: string) => r2(xs.filter((m) => m.status === st).reduce((s, m) => s + Number(m.amount), 0));
    const lineViews = lines.map((l) => {
      const ms = moves.filter((m) => m.budget_line_id === l.id);
      const actual = sum(ms, 'done');
      const committed = sum(ms, 'pending');
      const remaining = r2(l.amount - actual - committed);
      return {
        id: l.id, lineNo: l.lineNo, groupId: l.groupId, groupName: groups.find((g) => g.id === l.groupId)?.name ?? '', description: l.description, quantity: l.quantity,
        amount: l.amount, quarter: l.quarter, unitId: l.unitId, unitName: units.find((u) => u.id === l.unitId)?.name ?? null, externalRef: l.externalRef, notes: l.notes,
        actual, committed, remaining, usedPct: l.amount ? Math.round(((actual + committed) / l.amount) * 1000) / 10 : 0, over: remaining < 0,
        moves: ms.map((m) => ({ id: m.id, kind: m.kind, kindLabel: MOVE_AR[String(m.kind)], status: m.status, amount: Number(m.amount), date: m.date, asset: { id: m.asset_id, code: m.code, name: m.name } })),
      };
    });
    const byGroup = groups.map((g) => {
      const ls = lineViews.filter((l) => l.groupId === g.id);
      const un = moves.filter((m) => m.group_id === g.id && !m.budget_line_id);
      return {
        groupId: g.id, groupName: g.name, planned: r2(ls.reduce((s, l) => s + l.amount, 0)), actual: r2(ls.reduce((s, l) => s + l.actual, 0)),
        committed: r2(ls.reduce((s, l) => s + l.committed, 0)), unbudgeted: sum(un, 'done'), unbudgetedPending: sum(un, 'pending'),
      };
    }).filter((g) => g.planned || g.actual || g.unbudgeted || g.unbudgetedPending);
    const unbudgeted = moves.filter((m) => !m.budget_line_id).map((m) => ({
      id: m.id, kind: m.kind, kindLabel: MOVE_AR[String(m.kind)], status: m.status, amount: Number(m.amount), date: m.date, groupName: groups.find((g) => g.id === m.group_id)?.name ?? '',
      asset: { id: m.asset_id, code: m.code, name: m.name },
    }));
    const q = [1, 2, 3, 4].map((n) => ({ quarter: n, planned: r2(lineViews.filter((l) => l.quarter === n).reduce((s, l) => s + l.amount, 0)) }));
    return { ...head, notes: b.notes, lines: lineViews, byGroup, unbudgeted, quarters: q, unbudgetedTotal: r2(unbudgeted.filter((m) => m.status === 'done').reduce((s, m) => s + m.amount, 0)) };
  }

  private async linesOf(org: string, input: unknown) {
    if (!Array.isArray(input) || !input.length) bad('أضف بندًا واحدًا على الأقل');
    const arr = input as Record<string, unknown>[];
    if (arr.length > 300) bad('الموازنة 300 بند على الأكثر');
    const groups: { id: string }[] = await this.db.query('SELECT id FROM acc_asset_groups WHERE organization_id = $1', [org]);
    const units = await this.assets.units(org);
    return arr.map((l, i) => {
      const n = i + 1;
      const groupId = idOf(l.groupId, `مجموعة الأصول في البند ${n}`);
      if (!groups.some((g) => g.id === groupId)) bad(`مجموعة البند ${n} غير موجودة`);
      const quantity = l.quantity === undefined || l.quantity === null || l.quantity === '' ? 1 : Number(l.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) bad(`الكمية في البند ${n} غير صحيحة`);
      const quarter = l.quarter === undefined || l.quarter === null || l.quarter === '' ? null : Number(l.quarter);
      if (quarter !== null && ![1, 2, 3, 4].includes(quarter)) bad(`الربع في البند ${n} من 1 إلى 4`);
      const unitId = optId(l.unitId);
      if (unitId && !units.some((u) => u.id === unitId)) bad(`الجهة في البند ${n} غير موجودة`);
      return {
        id: optId(l.id), lineNo: n, groupId, description: str(l.description, 300) ?? bad(`اكتب وصف البند ${n}`), quantity, amount: amountOf(l.amount, `مبلغ البند ${n}`),
        quarter, unitId, externalRef: str(l.externalRef, 120), notes: str(l.notes, 1000),
      };
    });
  }

  async create(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsBudget, 'ليست لديك صلاحية الموازنة الرأسمالية');
    const org = actor.organizationId;
    const yearId = idOf(input.fiscalYearId, 'السنة المالية');
    const year = (await this.core.years(org)).find((y) => y.id === yearId) ?? bad('السنة المالية غير موجودة');
    if (await this.db.getRepository(CapitalBudget).exist({ where: { organizationId: org, fiscalYearId: yearId } })) bad(`للسنة ${year.name} موازنة رأسمالية بالفعل`);
    const lines = await this.linesOf(org, input.lines);
    const id = await this.db.transaction(async (em) => {
      const b = await em.getRepository(CapitalBudget).save(em.create(CapitalBudget, {
        organizationId: org, fiscalYearId: yearId, title: str(input.title, 200) ?? `الموازنة الرأسمالية لسنة ${year.name}`, status: 'draft',
        externalRef: str(input.externalRef, 120), notes: str(input.notes, 1000), createdByName: actor.fullName,
      }));
      await em.getRepository(CapitalBudgetLine).save(lines.map(({ id: _id, ...l }) => em.create(CapitalBudgetLine, { ...l, organizationId: org, budgetId: b.id })));
      return b.id;
    });
    return this.get(actor, id);
  }

  /** تعديل الموازنة وهي مسودة: البنود المرسلة تحل محل البنود الحالية */
  async update(actor: OrgUser, id: string, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsBudget, 'ليست لديك صلاحية الموازنة الرأسمالية');
    const org = actor.organizationId;
    const b = await this.db.getRepository(CapitalBudget).findOne({ where: { id, organizationId: org } }) ?? bad('الموازنة غير موجودة');
    if (b.status !== 'draft') bad('الموازنة معتمدة. أعدها لمسودة أولًا لتعديلها');
    const lines = await this.linesOf(org, input.lines);
    await this.db.transaction(async (em) => {
      await em.getRepository(CapitalBudget).update({ id }, { title: str(input.title, 200) ?? b.title, externalRef: str(input.externalRef, 120), notes: str(input.notes, 1000) });
      const old = await em.getRepository(CapitalBudgetLine).find({ where: { budgetId: id } });
      const keep = new Set(lines.map((l) => l.id).filter(Boolean));
      const drop = old.filter((o) => !keep.has(o.id)).map((o) => o.id);
      if (drop.length) {
        const [u] = await em.query(`SELECT COUNT(*)::int AS n FROM acc_asset_moves WHERE budget_line_id = ANY($1) AND status <> 'cancelled'`, [drop]);
        if (u.n) bad('لا يُحذف بند رُبطت به عمليات شراء');
        await em.getRepository(CapitalBudgetLine).delete(drop);
      }
      for (const { id: lid, ...l } of lines) {
        if (lid && old.some((o) => o.id === lid)) await em.getRepository(CapitalBudgetLine).update({ id: lid }, l);
        else await em.getRepository(CapitalBudgetLine).save(em.create(CapitalBudgetLine, { ...l, organizationId: org, budgetId: id }));
      }
    });
    return this.get(actor, id);
  }

  async approve(actor: OrgUser, id: string) {
    this.assets.need(actor, P.assetsBudget, 'ليست لديك صلاحية اعتماد الموازنة الرأسمالية');
    const b = await this.db.getRepository(CapitalBudget).findOne({ where: { id, organizationId: actor.organizationId } }) ?? bad('الموازنة غير موجودة');
    if (b.status === 'approved') bad('الموازنة معتمدة بالفعل');
    await this.db.getRepository(CapitalBudget).update({ id }, { status: 'approved', approvedByName: actor.fullName, approvedAt: new Date() });
    return this.get(actor, id);
  }

  /** إعادة الموازنة لمسودة للتعديل (تبقى العمليات المربوطة بها، ولا يُربط بها جديد حتى تُعتمد) */
  async reopen(actor: OrgUser, id: string) {
    this.assets.need(actor, P.assetsBudget, 'ليست لديك صلاحية الموازنة الرأسمالية');
    const b = await this.db.getRepository(CapitalBudget).findOne({ where: { id, organizationId: actor.organizationId } }) ?? bad('الموازنة غير موجودة');
    if (b.status !== 'approved') bad('الموازنة مسودة بالفعل');
    await this.db.getRepository(CapitalBudget).update({ id }, { status: 'draft', approvedByName: null, approvedAt: null });
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    this.assets.need(actor, P.assetsBudget, 'ليست لديك صلاحية الموازنة الرأسمالية');
    const b = await this.db.getRepository(CapitalBudget).findOne({ where: { id, organizationId: actor.organizationId } }) ?? bad('الموازنة غير موجودة');
    if (b.status !== 'draft') bad('لا تُحذف موازنة معتمدة');
    const [u] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_asset_moves m JOIN acc_asset_budget_lines l ON l.id = m.budget_line_id WHERE l.budget_id = $1 AND m.status <> 'cancelled'`, [id]);
    if (u.n) bad('رُبطت بالموازنة عمليات شراء، فلا تُحذف');
    await this.db.transaction(async (em) => {
      await em.getRepository(CapitalBudgetLine).delete({ budgetId: id });
      await em.getRepository(CapitalBudget).delete({ id });
    });
    return { ok: true };
  }

  /** بنود الموازنات المعتمدة لاختيارها في عمليات الشراء، مع المتبقي في كل بند */
  async options(actor: OrgUser) {
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT l.id, l.description, l.group_id, l.amount, y.name AS year, to_char(y.start_date, 'YYYY-MM-DD') AS start, to_char(y.end_date, 'YYYY-MM-DD') AS "end",
              COALESCE((SELECT SUM(m.amount) FROM acc_asset_moves m WHERE m.budget_line_id = l.id AND m.status <> 'cancelled'), 0) AS used
         FROM acc_asset_budget_lines l JOIN acc_asset_budgets b ON b.id = l.budget_id JOIN acc_fiscal_years y ON y.id = b.fiscal_year_id
        WHERE l.organization_id = $1 AND b.status = 'approved' ORDER BY y.start_date DESC, l.line_no`, [actor.organizationId]);
    return rows.map((r) => ({
      id: r.id, description: r.description, groupId: r.group_id, amount: Number(r.amount), remaining: r2(Number(r.amount) - Number(r.used)), year: r.year, start: r.start, end: r.end,
    }));
  }
}
